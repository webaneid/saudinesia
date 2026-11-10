import { Prisma, type DocumentRejectReason, type DocumentReviewStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { consume, policy } from '@/lib/auth/rateLimit'
import { lockCardOwner, type Actor } from '@/lib/pilgrims/service'
import { reopenForChangedDocument } from '@/lib/pilgrims/review'
import { pilgrimRequirements } from './requirements'
import { calendarDateOf, dbDateOf, todayInApp, type CalendarDate } from '@/lib/time'
import type { DocumentUploadFields } from '@/lib/validators/documents'
import { DocumentFileRejected, prepareDocumentFile } from './file'
import { minioDocumentStorage, newDocumentKey, removeObjectsQuietly, type DocumentStorage } from './storage'

// SATU-SATUNYA penulis dokumen jamaah (`pilgrim_documents`) dan objeknya di MinIO — docs/arsitektur-jamaah.md §7 (Fase 4).
// - Cakupan sama dengan kartu: pemilik sendiri atau staf (atas nama pelanggan); kartu akun lain = 404 yang sama dengan "tidak ada".
// - Urutan kunci sama dengan layanan kartu: baris pemilik FOR SHARE (penghapusan akun menunggu) → baris kartu FOR UPDATE (hapus kartu dan
//   unggahan lain pada kartu yang sama berurutan). Berkas diunggah SEBELUM transaksi; bila transaksi menolak, berkas baru dibuang.
// - Jenis `allowMultiple = false`: unggahan baru MENGGANTI berkas jenis itu (baris lama dihapus, objek lama dihapus sesudah commit — K12).
// - Dua cakupan: kartu (`bookingId` null — jenis `reusable`: paspor, KTP…) dan PERJALANAN (`bookingId` = booking yang menautkan kartu ini —
//   jenis non-reusable: tiket, reservasi; Fase 7a). Cakupan perjalanan hanya bila jamaah booking itu memang tertaut ke kartu (dicek di dalam kunci).

export const MAX_DOCUMENTS_PER_CARD = 30
export const PREVIEW_TTL_SECONDS = 900

export type DocumentTypeOption = {
  id: string; key: string; label: string; icon: string; hasExpiry: boolean; minValidityMonths: number | null
  referenceLabel: string | null; referencePattern: string | null; allowMultiple: boolean
}

export type PilgrimDocumentView = {
  id: string
  documentTypeId: string
  typeKey: string
  label: string
  referenceCode: string | null
  mimeType: string
  sizeBytes: number
  issuedAt: CalendarDate | null
  expiresAt: CalendarDate | null
  status: DocumentReviewStatus
  rejectReason: DocumentRejectReason | null
  reviewNote: string | null
  /** Diunggah staf atas nama pelanggan (bukan siapa — id staf tidak ke klien). */
  byStaff: boolean
  createdAt: string
}

export type DocServiceError = { ok: false; status: 400 | 404 | 409 | 422 | 429 | 503; error: string; field?: string; retryAfterSec?: number }

const docSelect = {
  id: true, documentTypeId: true, label: true, referenceCode: true, mimeType: true, sizeBytes: true, issuedAt: true, expiresAt: true,
  status: true, rejectReason: true, reviewNote: true, uploadedById: true, createdAt: true, documentType: { select: { key: true } },
  savedPilgrim: { select: { ownerId: true } },
} satisfies Prisma.PilgrimDocumentSelect
type DocRow = Prisma.PilgrimDocumentGetPayload<{ select: typeof docSelect }>

const cal = (d: Date | null): CalendarDate | null => (d ? calendarDateOf(d) : null)
const toView = (r: DocRow): PilgrimDocumentView => ({
  id: r.id, documentTypeId: r.documentTypeId, typeKey: r.documentType.key, label: r.label, referenceCode: r.referenceCode, mimeType: r.mimeType,
  sizeBytes: r.sizeBytes, issuedAt: cal(r.issuedAt), expiresAt: cal(r.expiresAt), status: r.status, rejectReason: r.rejectReason, reviewNote: r.reviewNote,
  byStaff: r.uploadedById !== r.savedPilgrim.ownerId, createdAt: r.createdAt.toISOString(),
})

const typeSelect = {
  id: true, key: true, label: true, icon: true, hasExpiry: true, minValidityMonths: true, referenceLabel: true, referencePattern: true, allowMultiple: true,
} satisfies Prisma.DocumentTypeSelect

const isStaff = (actor: Actor) => ADMIN_ROLES.includes(actor.role)
const allowed = (actor: Actor, ownerId: string) => actor.userId === ownerId || isStaff(actor)
const notFound = (): DocServiceError => ({ ok: false, status: 404, error: 'Data jamaah tidak ditemukan' })
const bad = (error: string, field?: string): DocServiceError => ({ ok: false, status: 400, error, ...(field ? { field } : {}) })
const notRequired = (): DocServiceError => bad('Dokumen ini tidak diminta untuk booking ini', 'documentTypeId')

class Abort extends Error {
  constructor(readonly result: DocServiceError) { super(result.error) }
}

/** Cakupan dokumen: kartu (milik orang) atau satu perjalanan (booking yang menautkan kartu). */
export type DocScope = { bookingId: string | null }
const CARD_SCOPE: DocScope = { bookingId: null }

const typeOrder = [{ order: 'asc' }, { label: 'asc' }, { id: 'asc' }] satisfies Prisma.DocumentTypeOrderByWithRelationInput[]

/** Jenis milik orang (kartu Jamaah Saya — dipakai lintas booking, jadi semua jenis aktif), urut katalog. */
export function uploadableTypes(): Promise<DocumentTypeOption[]> {
  return prisma.documentType.findMany({ where: { isActive: true, reusable: true }, select: typeSelect, orderBy: typeOrder })
}

/** Jenis dokumen PERJALANAN yang DIMINTA produk jamaah booking yang menautkan kartu ini (pilgrimRequirements: Paket → Haji → Visa) —
 *  sumber yang SAMA dengan daftar periksa jamaah dan pemeriksaan petugas, supaya yang bisa diunggah = yang diperiksa (pemilik 2026-11-10). */
async function tripTypeIds(db: Prisma.TransactionClient | typeof prisma, bookingId: string, cardId: string): Promise<Set<string> | null> {
  const bps = await db.bookingPilgrim.findMany({ where: { bookingId, savedPilgrimId: cardId }, select: { id: true } })
  if (bps.length === 0) return null // kartu tak tertaut ke booking ini → 404 (sama dengan lockTripScope), bukan "tak diminta"
  const reqs = await pilgrimRequirements(db, bps.map(b => b.id))
  return new Set([...reqs.values()].flat().filter(r => !r.reusable).map(r => r.documentTypeId))
}

/** Jenis yang bisa diunggah per perjalanan: hanya syarat produk (aktif), urut katalog. */
export async function tripUploadableTypes(bookingId: string, cardId: string): Promise<DocumentTypeOption[]> {
  const ids = await tripTypeIds(prisma, bookingId, cardId)
  if (!ids || ids.size === 0) return []
  return prisma.documentType.findMany({ where: { id: { in: [...ids] }, isActive: true, reusable: false }, select: typeSelect, orderBy: typeOrder })
}

/** Dokumen kartu milik `ownerId`; `null` = bukan haknya / kartu tidak ada (404 yang sama). */
export async function listCardDocuments(actor: Actor, ownerId: string, cardId: string, scope: DocScope = CARD_SCOPE): Promise<PilgrimDocumentView[] | null> {
  if (!allowed(actor, ownerId)) return null
  const card = await prisma.savedPilgrim.findFirst({ where: { id: cardId, ownerId }, select: { id: true } })
  if (!card) return null
  const rows = await prisma.pilgrimDocument.findMany({
    where: { savedPilgrimId: cardId, bookingId: scope.bookingId }, select: docSelect,
    orderBy: [{ documentType: { order: 'asc' } }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toView)
}

async function rateLimited(actor: Actor): Promise<DocServiceError | null> {
  const hit = await consume(policy(isStaff(actor) ? 'pilgrimDocStaff' : 'pilgrimDocUser', actor.userId))
  return hit.allowed ? null : { ok: false, status: 429, error: 'Terlalu banyak unggahan dokumen. Coba lagi nanti.', retryAfterSec: hit.retryAfterSec }
}

/** Kunci pemilik + baris kartu; kartu harus milik `ownerId` dan tidak diarsipkan. */
async function lockCard(tx: Prisma.TransactionClient, actor: Actor, ownerId: string, cardId: string): Promise<void> {
  const refusal = await lockCardOwner(tx, actor, ownerId)
  if (refusal) throw new Abort(refusal)
  // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
  const rows = await tx.$queryRaw<{ archivedAt: Date | null }[]>`SELECT "archivedAt" FROM "saved_pilgrims" WHERE "id" = ${cardId} AND "ownerId" = ${ownerId} FOR UPDATE`
  const card = rows[0]
  if (!card) throw new Abort(notFound())
  if (card.archivedAt) throw new Abort({ ok: false, status: 409, error: 'Data jamaah ini diarsipkan — pulihkan dulu sebelum mengubah dokumennya' })
}

/** Cakupan perjalanan: ada jamaah booking `bookingId` (bukan draf, milik `ownerId`) yang tertaut ke kartu — dikunci FOR SHARE supaya lepas-tautan
 *  (lib/pilgrims/bookingLink.ts, FOR UPDATE) menunggu unggahan ini dan sebaliknya. */
async function lockTripScope(tx: Prisma.TransactionClient, ownerId: string, cardId: string, scope: DocScope): Promise<void> {
  if (scope.bookingId === null) return
  // $queryRaw: Prisma ORM tidak punya SELECT ... FOR SHARE.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT bp."id" FROM "booking_pilgrims" bp JOIN "bookings" b ON b."id" = bp."bookingId"
    WHERE bp."bookingId" = ${scope.bookingId} AND bp."savedPilgrimId" = ${cardId} AND b."userId" = ${ownerId} AND b."status" <> 'draft'
    FOR SHARE OF bp`
  if (rows.length === 0) throw new Abort(notFound())
}

type Checked = { label: string; referenceCode: string | null; issuedAt: CalendarDate | null; expiresAt: CalendarDate | null }

/** Aturan per jenis (masukan sudah lolos Zod): label bebas hanya `other`, kode referensi sesuai pola, tanggal masuk akal. */
export function checkUploadFields(type: DocumentTypeOption, f: DocumentUploadFields, today: CalendarDate = todayInApp()): Checked | DocServiceError {
  let label = type.label
  if (type.key === 'other') {
    if (!f.label) return bad('Isi nama dokumen', 'label')
    label = f.label
  } else if (f.label !== undefined) return bad('Nama dokumen hanya untuk "Dokumen Lain"', 'label')

  let referenceCode: string | null = null
  if (type.referenceLabel) {
    const code = (f.referenceCode ?? '').toUpperCase().replace(/\s+/g, '')
    if (type.referencePattern) {
      if (!code) return bad(`Isi ${type.referenceLabel}`, 'referenceCode')
      if (!new RegExp(type.referencePattern).test(code)) return bad(`${type.referenceLabel} tidak sesuai format`, 'referenceCode')
    }
    referenceCode = code || null
  } else if (f.referenceCode) return bad('Jenis dokumen ini tidak memakai kode referensi', 'referenceCode')

  if (!type.hasExpiry && (f.issuedAt || f.expiresAt)) return bad('Jenis dokumen ini tidak memakai masa berlaku', 'expiresAt')
  if (type.minValidityMonths != null && !f.expiresAt) return bad('Isi tanggal habis berlaku', 'expiresAt')
  if (f.issuedAt && f.issuedAt > today) return bad('Tanggal terbit tidak boleh di masa depan', 'issuedAt')
  if (f.issuedAt && f.expiresAt && f.issuedAt >= f.expiresAt) return bad('Tanggal habis berlaku harus sesudah tanggal terbit', 'expiresAt')
  return { label, referenceCode, issuedAt: f.issuedAt ?? null, expiresAt: f.expiresAt ?? null }
}

export function createDocumentService(storage: DocumentStorage = minioDocumentStorage) {
  async function upload(actor: Actor, ownerId: string, cardId: string, fields: DocumentUploadFields, file: Buffer, scope: DocScope = CARD_SCOPE): Promise<{ ok: true; document: PilgrimDocumentView } | DocServiceError> {
    if (!allowed(actor, ownerId)) return notFound()
    const limited = await rateLimited(actor)
    if (limited) return limited
    const type = await prisma.documentType.findFirst({ where: { id: fields.documentTypeId, isActive: true, reusable: scope.bookingId === null }, select: typeSelect })
    if (!type) return bad('Jenis dokumen tidak tersedia', 'documentTypeId')
    if (scope.bookingId !== null) {
      const ids = await tripTypeIds(prisma, scope.bookingId, cardId)
      if (!ids) return notFound()
      if (!ids.has(type.id)) return notRequired()
    }
    const checked = checkUploadFields(type, fields)
    if ('ok' in checked) return checked
    // Pemeriksaan murah sebelum memproses berkas (yang otoritatif diulang di dalam kunci).
    const card = await prisma.savedPilgrim.findFirst({ where: { id: cardId, ownerId }, select: { archivedAt: true } })
    if (!card) return notFound()
    if (card.archivedAt) return { ok: false, status: 409, error: 'Data jamaah ini diarsipkan — pulihkan dulu sebelum mengubah dokumennya' }

    let prepared
    try { prepared = await prepareDocumentFile(file) } catch (e) {
      if (e instanceof DocumentFileRejected) return bad(e.message, 'file')
      throw e
    }
    const key = newDocumentKey(ownerId, cardId, type.key, prepared.ext)
    try {
      await storage.put(key, prepared.body, prepared.mimeType)
    } catch {
      return { ok: false, status: 503, error: 'Penyimpanan berkas sedang bermasalah. Coba lagi.' }
    }

    let replaced: string[] = []
    try {
      const row = await prisma.$transaction(async (tx) => {
        await lockCard(tx, actor, ownerId, cardId)
        await lockTripScope(tx, ownerId, cardId, scope)
        // Diperiksa ulang di dalam kunci: syarat bisa berubah (revisi booking) sejak pemeriksaan murah di atas.
        if (scope.bookingId !== null && !(await tripTypeIds(tx, scope.bookingId, cardId))?.has(type.id)) throw new Abort(notRequired())
        if (!type.allowMultiple) {
          const old = await tx.pilgrimDocument.findMany({ where: { savedPilgrimId: cardId, bookingId: scope.bookingId, documentTypeId: type.id }, select: { id: true, objectKey: true } })
          replaced = old.map(o => o.objectKey)
          if (old.length > 0) {
            // Pengajuan aktif yang memakai jenis ini diperiksa ulang (keputusan pemilik 2026-11-03, docs/arsitektur-jamaah.md §8.4).
            // Ubah dokumen DULU, baru buka ulang (SEC-200): keputusan petugas yang memegang FOR SHARE atas dokumen ini selesai lebih dulu, dan reopen melihatnya.
            await tx.pilgrimDocument.deleteMany({ where: { id: { in: old.map(o => o.id) } } })
            await reopenForChangedDocument(tx, { savedPilgrimId: cardId, bookingId: scope.bookingId, documentTypeId: type.id }, actor.userId, 'Dokumen diganti')
          }
        }
        if ((await tx.pilgrimDocument.count({ where: { savedPilgrimId: cardId } })) >= MAX_DOCUMENTS_PER_CARD) {
          throw new Abort({ ok: false, status: 409, error: `Maksimal ${MAX_DOCUMENTS_PER_CARD} dokumen per jamaah. Hapus dokumen yang tidak dipakai.` })
        }
        return tx.pilgrimDocument.create({
          data: {
            savedPilgrimId: cardId, bookingId: scope.bookingId, documentTypeId: type.id, label: checked.label, referenceCode: checked.referenceCode,
            objectKey: key, mimeType: prepared.mimeType, sizeBytes: prepared.sizeBytes, sha256: prepared.sha256,
            issuedAt: checked.issuedAt ? dbDateOf(checked.issuedAt) : null, expiresAt: checked.expiresAt ? dbDateOf(checked.expiresAt) : null,
            uploadedById: actor.userId,
          },
          select: docSelect,
        })
      })
      await removeObjectsQuietly(storage, replaced, 'documents/replace')
      return { ok: true, document: toView(row) }
    } catch (e) {
      await removeObjectsQuietly(storage, [key], 'documents/upload-rollback')
      if (e instanceof Abort) return e.result
      // Jenis dihapus admin di antara pembacaan di atas dan INSERT (FK) — bukan galat server (SEC-185).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') return bad('Jenis dokumen tidak tersedia', 'documentTypeId')
      throw e
    }
  }

  async function remove(actor: Actor, ownerId: string, cardId: string, docId: string, scope: DocScope = CARD_SCOPE): Promise<{ ok: true } | DocServiceError> {
    if (!allowed(actor, ownerId)) return notFound()
    const limited = await rateLimited(actor)
    if (limited) return limited
    try {
      const key = await prisma.$transaction(async (tx) => {
        await lockCard(tx, actor, ownerId, cardId)
        await lockTripScope(tx, ownerId, cardId, scope)
        const doc = await tx.pilgrimDocument.findFirst({ where: { id: docId, savedPilgrimId: cardId, bookingId: scope.bookingId }, select: { objectKey: true, documentTypeId: true } })
        if (!doc) throw new Abort({ ok: false, status: 404, error: 'Dokumen tidak ditemukan' })
        await tx.pilgrimDocument.delete({ where: { id: docId } })
        await reopenForChangedDocument(tx, { savedPilgrimId: cardId, bookingId: scope.bookingId, documentTypeId: doc.documentTypeId }, actor.userId, 'Dokumen dihapus') // sesudah mengubah (SEC-200)
        return doc.objectKey
      })
      await removeObjectsQuietly(storage, [key], 'documents/delete')
      return { ok: true }
    } catch (e) {
      if (e instanceof Abort) return e.result
      throw e
    }
  }

  /** URL presigned 15 menit untuk melihat satu dokumen — hanya pemilik kartu atau staf. Bucket tetap privat. */
  async function previewUrl(actor: Actor, ownerId: string, cardId: string, docId: string, scope: DocScope = CARD_SCOPE): Promise<{ ok: true; url: string; mimeType: string } | DocServiceError> {
    if (!allowed(actor, ownerId)) return notFound()
    const doc = await prisma.pilgrimDocument.findFirst({
      where: { id: docId, savedPilgrimId: cardId, bookingId: scope.bookingId, savedPilgrim: { ownerId } }, select: { objectKey: true, mimeType: true },
    })
    if (!doc) return { ok: false, status: 404, error: 'Dokumen tidak ditemukan' }
    try {
      return { ok: true, url: await storage.url(doc.objectKey, PREVIEW_TTL_SECONDS), mimeType: doc.mimeType }
    } catch {
      return { ok: false, status: 503, error: 'Penyimpanan berkas sedang bermasalah. Coba lagi.' }
    }
  }

  return { upload, remove, previewUrl }
}

export const documentService = createDocumentService()
