import { Prisma, type PilgrimReviewStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isRetryableConflict, retryConflict } from '@/lib/booking/serializable'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { consume, policy } from '@/lib/auth/rateLimit'
import { codedError, type ApiErrorCode } from '@/lib/errors/api'
import type { ApiErrorParams } from '@/lib/errors/params'
import { completeness } from '@/lib/manifest/values'
import { pilgrimRequirements } from '@/lib/documents/requirements'
import { evaluateCompleteness, type CompletenessItem } from '@/lib/documents/completeness'
import { notify } from '@/lib/notifications/notify'
import { calendarDateOf, todayInApp, type CalendarDate } from '@/lib/time'
import { manifestFieldsOf } from './bookingLink'
import { applyVerifiedSnapshot, lockCardOwner, type Actor, type ServiceError, type VerifiedCanonical } from './service'
import { REVIEW_LABEL } from './reviewState'

// SATU-SATUNYA penulis status pengajuan jamaah booking (`booking_pilgrims.reviewStatus/submittedAt/verifiedAt/verifiedById`), riwayatnya
// (`pilgrim_review_events`, append-only di DB), dan dokumen yang dipakai pengajuan (`booking_pilgrim_documents`) — docs/arsitektur-jamaah.md §8.4.
// - Alur: draft → submitted (pemesan/staf, data & dokumen wajib lengkap) → verified (staf, dokumen wajib DITERIMA) | needs_revision (staf, catatan
//   wajib) → submitted lagi. Dokumen pengajuan terverifikasi diganti/dihapus/ditolak pada booking aktif → kembali `submitted` (keputusan pemilik 2026-11-03).
// - Urutan kunci: `users` pemilik FOR SHARE → `booking_pilgrims` FOR UPDATE (sama dengan lib/pilgrims/bookingLink.ts). Layanan dokumen memanggil
//   `reopenForChangedDocument` sesudah mengunci kartu DAN sesudah mengubah dokumen (kartu → dokumen → jamaah booking); jalur di sini TIDAK pernah mengunci/menulis kartu sesudah jamaah booking.
// - Kelengkapan selalu dinilai ULANG di dalam kunci dari data hidup (bukan dari tautan dokumen). Verifikasi mengunci dokumen kartu FOR SHARE
//   SEBELUM jamaah booking (urutan dokumen → jamaah booking, sama dengan layanan dokumen — SEC-200).

type Tx = Prisma.TransactionClient
export type ReviewResult = { ok: true; status: PilgrimReviewStatus } | ServiceError
export type ReviewDecision = { decision: 'verified' | 'needs_revision'; note?: string | null }

class Abort extends Error {
  constructor(readonly result: ServiceError) { super(result.error) }
}
const fail = (status: ServiceError['status'], code: ApiErrorCode, field?: string, params?: ApiErrorParams): never => { throw new Abort({ ok: false, status, ...codedError(code, params), ...(field ? { field } : {}) }) }
const notFound = () => fail(404, 'bookingPilgrimNotFound')
const isStaff = (actor: Actor) => ADMIN_ROLES.includes(actor.role)

type Locked = {
  id: string; bookingId: string; bookingCode: string; ownerId: string; status: PilgrimReviewStatus; savedPilgrimId: string | null; identityId: string | null
  fieldValues: Record<string, unknown>; visaProductId: string | null; referenceDate: CalendarDate
}

/** Kunci pemilik (FOR SHARE) lalu jamaah booking (FOR UPDATE). Booking harus `active`; jamaah hanya melihat booking miliknya (404 yang sama). */
async function lockForReview(tx: Tx, actor: Actor, bookingId: string, bookingPilgrimId: string, lockDocs = false): Promise<Locked> {
  const head = await tx.bookingPilgrim.findFirst({
    where: { id: bookingPilgrimId, bookingId, booking: { status: { not: 'draft' } } },
    select: { booking: { select: { userId: true, status: true, bookingCode: true, departureDate: true } } },
  })
  if (!head) return notFound()
  const { userId: ownerId, status, bookingCode: code, departureDate } = head.booking
  if (!isStaff(actor) && actor.userId !== ownerId) return notFound()
  if (status !== 'active') return fail(409, 'submissionClosed')
  const refusal = await lockCardOwner(tx, actor, ownerId)
  if (refusal) throw new Abort(refusal.status === 404 ? { ok: false, status: 404, ...codedError('bookingPilgrimNotFound') } : refusal)
  // Keputusan: dokumen kartu dikunci FOR SHARE SEBELUM jamaah booking (SEC-200) — urutan sama dengan layanan dokumen (dokumen → jamaah booking),
  // jadi tolak/ganti/hapus serentak menunggu keputusan selesai lalu membuka ulang, dan yang dinilai = isi terkunci. $queryRaw: tak ada FOR SHARE di ORM.
  let cardSeen: string | null = null
  if (lockDocs) {
    cardSeen = (await tx.bookingPilgrim.findUnique({ where: { id: bookingPilgrimId }, select: { savedPilgrimId: true } }))?.savedPilgrimId ?? null
    if (cardSeen) await tx.$queryRaw`SELECT "id" FROM "pilgrim_documents" WHERE "savedPilgrimId" = ${cardSeen} AND ("bookingId" IS NULL OR "bookingId" = ${bookingId}) ORDER BY "id" FOR SHARE`
  }
  // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
  const rows = await tx.$queryRaw<{ reviewStatus: PilgrimReviewStatus; savedPilgrimId: string | null; identityId: string | null; fieldValues: unknown; bookingStatus: string }[]>`
    SELECT bp."reviewStatus", bp."savedPilgrimId", bp."identityId", bp."fieldValues", b."status"::text AS "bookingStatus"
    FROM "booking_pilgrims" bp JOIN "bookings" b ON b."id" = bp."bookingId"
    WHERE bp."id" = ${bookingPilgrimId} AND bp."bookingId" = ${bookingId} FOR UPDATE OF bp`
  const row = rows[0]
  if (!row) return notFound()
  // Dibaca ulang sesudah kunci (SEC-203): pembatalan/hangus serentak tak diikuti verifikasi + email.
  if (row.bookingStatus !== 'active') return fail(409, 'submissionClosed')
  if (lockDocs && row.savedPilgrimId !== cardSeen) return fail(409, 'pilgrimDataChanged')
  const visa = await tx.visaApplication.findUnique({ where: { bookingPilgrimId }, select: { visaProductId: true, plannedTravelDate: true } })
  const referenceDate = visa?.plannedTravelDate ? calendarDateOf(visa.plannedTravelDate) : departureDate ? calendarDateOf(departureDate) : todayInApp()
  return {
    id: bookingPilgrimId, bookingId, bookingCode: code, ownerId, status: row.reviewStatus, savedPilgrimId: row.savedPilgrimId, identityId: row.identityId,
    fieldValues: (row.fieldValues ?? {}) as Record<string, unknown>, visaProductId: visa?.visaProductId ?? null, referenceDate,
  }
}

type Assessment = { fields: Awaited<ReturnType<typeof manifestFieldsOf>>; missingFields: string[]; items: CompletenessItem[]; ready: boolean; verified: boolean; usedDocIds: string[] }

/** Nilai data + dokumen jamaah ini sekarang. Dokumen = milik orang di kartu tertaut + dokumen perjalanan booking ini, untuk jenis yang disyaratkan. */
async function assess(tx: Tx, bp: Locked): Promise<Assessment> {
  const fields = await manifestFieldsOf(tx, bp.visaProductId)
  const data = completeness(fields, bp.fieldValues)
  // Gabungan syarat semua produk yang memuat jamaah ini (Paket → Haji → Visa, docs/rencana-visa-produk.md §3.2).
  const requirements = (await pilgrimRequirements(tx, [bp.id])).get(bp.id) ?? []
  const typeIds = requirements.map(r => r.documentTypeId)
  const docs = bp.savedPilgrimId && typeIds.length > 0
    ? await tx.pilgrimDocument.findMany({
        where: { savedPilgrimId: bp.savedPilgrimId, OR: [{ bookingId: null }, { bookingId: bp.bookingId }], documentTypeId: { in: typeIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, documentTypeId: true, status: true, expiresAt: true },
      })
    : []
  const c = evaluateCompleteness({
    requirements, referenceDate: bp.referenceDate,
    documents: docs.map(d => ({ documentTypeId: d.documentTypeId, status: d.status, expiresAt: d.expiresAt ? calendarDateOf(d.expiresAt) : null })),
  })
  return {
    fields, missingFields: data.missing, items: c.items, ready: data.complete && c.ready, verified: data.complete && c.verified,
    usedDocIds: docs.filter(d => d.status !== 'rejected').map(d => d.id),
  }
}

async function relinkDocuments(tx: Tx, bookingPilgrimId: string, docIds: readonly string[]) {
  await tx.bookingPilgrimDocument.deleteMany({ where: { bookingPilgrimId } })
  if (docIds.length > 0) await tx.bookingPilgrimDocument.createMany({ data: docIds.map(pilgrimDocumentId => ({ bookingPilgrimId, pilgrimDocumentId })) })
}

async function transition(tx: Tx, bp: Locked, to: PilgrimReviewStatus, actorId: string | null, note: string | null, verifiedById?: string) {
  const now = new Date()
  await tx.bookingPilgrim.update({
    where: { id: bp.id },
    data: {
      reviewStatus: to,
      ...(to === 'submitted' ? { submittedAt: now } : {}),
      verifiedAt: to === 'verified' ? now : null,
      verifiedById: to === 'verified' ? (verifiedById ?? null) : null,
    },
    select: { id: true },
  })
  await tx.pilgrimReviewEvent.create({ data: { bookingPilgrimId: bp.id, fromStatus: bp.status, toStatus: to, actorId, note } })
}

/** Yang kurang untuk diajukan/diverifikasi. Nama kolom/dokumen = label admin (data, tidak diterjemahkan). */
function missing(a: Assessment, need: 'ready' | 'verified'): { code: ApiErrorCode; params: ApiErrorParams } {
  if (a.missingFields.length > 0) return { code: 'missingFields', params: { fields: a.missingFields.slice(0, 5).join(', ') } }
  const bad = a.items.filter(i => i.required && (need === 'ready' ? i.state !== 'pending' && i.state !== 'accepted' : i.state !== 'accepted'))
  const documents = bad.slice(0, 5).map(i => i.label).join(', ')
  return { code: need === 'ready' ? 'documentsIncomplete' : 'documentsNotAccepted', params: { documents } }
}

async function rateLimited(actor: Actor): Promise<ServiceError | null> {
  const hit = await consume(policy(isStaff(actor) ? 'pilgrimWriteStaff' : 'pilgrimWriteUser', actor.userId))
  return hit.allowed ? null : { ok: false, status: 429, ...codedError('tooManyPilgrimChanges'), retryAfterSec: hit.retryAfterSec }
}

type Done = { status: PilgrimReviewStatus; notifyTo?: { ownerId: string; bookingId: string; code: string } }

async function run(actor: Actor, fn: (tx: Tx) => Promise<Done>): Promise<ReviewResult> {
  const limited = await rateLimited(actor)
  if (limited) return limited
  let done: Done
  try {
    done = await retryConflict(() => prisma.$transaction(fn)) // deadlock dengan gabung identitas (F8, SEC-205) → ulang
  } catch (e) {
    if (e instanceof Abort) return e.result
    if (isRetryableConflict(e)) return { ok: false, status: 409, ...codedError('pilgrimConcurrent') }
    // Dokumen yang hendak ditautkan dihapus di sela pembacaan dan penulisan tautan (FK) — muat ulang dan coba lagi.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') return { ok: false, status: 409, ...codedError('documentsChanged') }
    throw e
  }
  const n = done.notifyTo
  if (n) await notify({ userId: n.ownerId, bookingId: n.bookingId, event: { type: 'pilgrim_review', code: n.code, status: REVIEW_LABEL[done.status] } })
  return { ok: true, status: done.status }
}

/** Ajukan data jamaah untuk diperiksa — pemesan sendiri atau staf atas namanya. Dari `draft`/`needs_revision`; kartu tertaut; data & dokumen wajib siap. */
export function submitPilgrim(actor: Actor, bookingId: string, bookingPilgrimId: string): Promise<ReviewResult> {
  return run(actor, async (tx) => {
    const bp = await lockForReview(tx, actor, bookingId, bookingPilgrimId)
    if (bp.status !== 'draft' && bp.status !== 'needs_revision') return fail(409, bp.status === 'verified' ? 'alreadyVerified' : 'alreadySubmitted')
    if (!bp.savedPilgrimId) return fail(409, 'chooseCardFirst')
    const a = await assess(tx, bp)
    if (!a.ready) { const m = missing(a, 'ready'); return fail(422, m.code, undefined, m.params) }
    await relinkDocuments(tx, bp.id, a.usedDocIds)
    await transition(tx, bp, 'submitted', actor.userId, null)
    // Pemesan tak perlu email atas tindakannya sendiri; diajukan staf atas namanya → diberi tahu.
    return { status: 'submitted', ...(actor.userId !== bp.ownerId ? { notifyTo: { ownerId: bp.ownerId, bookingId, code: bp.bookingCode } } : {}) }
  })
}

/** Keputusan petugas atas pengajuan `submitted`: terverifikasi (dokumen wajib diterima semua) atau dikembalikan (catatan wajib). */
export function decidePilgrim(actor: Actor, bookingId: string, bookingPilgrimId: string, input: ReviewDecision): Promise<ReviewResult> {
  if (!isStaff(actor)) return Promise.resolve({ ok: false, status: 404, ...codedError('bookingPilgrimNotFound') })
  const note = input.note?.trim() || null
  if (input.decision === 'needs_revision' && !note) return Promise.resolve({ ok: false, status: 400, ...codedError('reviewNoteRequired'), field: 'note' })
  return run(actor, async (tx) => {
    const bp = await lockForReview(tx, actor, bookingId, bookingPilgrimId, input.decision === 'verified')
    if (bp.status !== 'submitted') return fail(409, bp.status === 'verified' ? 'alreadyVerified' : 'notSubmitted')
    if (input.decision === 'needs_revision') {
      await transition(tx, bp, 'needs_revision', actor.userId, note)
    } else {
      const a = await assess(tx, bp)
      if (!a.verified) { const m = missing(a, 'verified'); return fail(422, m.code, undefined, m.params) }
      await relinkDocuments(tx, bp.id, a.usedDocIds)
      await transition(tx, bp, 'verified', actor.userId, note, actor.userId)
      if (bp.identityId) await applyVerifiedSnapshot(tx, bp.identityId, canonicalOf(a.fields, bp.fieldValues), actor.userId, bp.id)
    }
    return { status: input.decision, notifyTo: { ownerId: bp.ownerId, bookingId, code: bp.bookingCode } }
  })
}

/** Atribut kanonik dari snapshot terverifikasi (field berperan, bentuk yang bisa dipastikan); atribut lain dibiarkan. */
function canonicalOf(fields: readonly { fieldKey: string; role: string | null }[], values: Record<string, unknown>): VerifiedCanonical {
  const v = (role: string) => { const f = fields.find(x => x.role === role); const raw = f ? values[f.fieldKey] : undefined; return typeof raw === 'string' ? raw.trim() : '' }
  const out: VerifiedCanonical = {}
  const name = v('display_name'); if (name) out.fullName = name.slice(0, 200)
  const gender = v('gender'); if (gender === 'male' || gender === 'female') out.gender = gender
  const place = v('birth_place'); if (place) out.birthPlace = place.slice(0, 100)
  const birth = v('birth_date'); if (/^\d{4}-\d{2}-\d{2}$/.test(birth)) out.birthDate = birth as CalendarDate
  const nat = v('nationality'); if (/^[A-Z]{2}$/.test(nat)) out.nationality = nat
  return out
}

/**
 * Dokumen kartu berubah (diganti, dihapus, atau ditolak petugas) — dipanggil layanan dokumen di dalam transaksinya SESUDAH mengunci kartu.
 * Pengajuan TERVERIFIKASI pada booking AKTIF yang memakai kartu itu dan mensyaratkan jenis dokumen tersebut kembali `submitted` (riwayat
 * tercatat); yang masih `submitted` memang belum diputus (keputusan selalu menilai ulang dokumen hidup); booking selesai/batal tidak terpengaruh. Dokumen perjalanan hanya memengaruhi booking-nya sendiri.
 */
export async function reopenForChangedDocument(tx: Tx, doc: { savedPilgrimId: string; bookingId: string | null; documentTypeId: string }, actorId: string, reason: string): Promise<number> {
  // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE. Kondisi status ada di baris yang dikunci → dinilai ulang sesudah menunggu kunci.
  const rows = await tx.$queryRaw<{ id: string; reviewStatus: PilgrimReviewStatus }[]>`
    SELECT bp."id", bp."reviewStatus" FROM "booking_pilgrims" bp JOIN "bookings" b ON b."id" = bp."bookingId"
    WHERE bp."savedPilgrimId" = ${doc.savedPilgrimId} AND bp."reviewStatus" = 'verified' AND b."status" = 'active'
      ${doc.bookingId ? Prisma.sql`AND bp."bookingId" = ${doc.bookingId}` : Prisma.empty}
    ORDER BY bp."id" FOR UPDATE OF bp`
  let reopened = 0
  // Disyaratkan = jenis ada di GABUNGAN syarat jamaah itu (paket/haji/visa), wajib maupun opsional — sama dengan yang dinilai `assess`.
  const reqs = await pilgrimRequirements(tx, rows.map(r => r.id))
  for (const r of rows) {
    if (!(reqs.get(r.id) ?? []).some(q => q.documentTypeId === doc.documentTypeId)) continue
    await tx.bookingPilgrim.update({ where: { id: r.id }, data: { reviewStatus: 'submitted', verifiedAt: null, verifiedById: null }, select: { id: true } })
    await tx.pilgrimReviewEvent.create({ data: { bookingPilgrimId: r.id, fromStatus: r.reviewStatus, toStatus: 'submitted', actorId, note: reason } })
    reopened++
  }
  return reopened
}

/**
 * Syarat jamaah booking BERTAMBAH (mis. revisi booking memasang visa paket ke jamaah yang sudah terverifikasi, SEC-201): verifikasi lama tak lagi
 * mencakup syarat baru → dibuka ulang ke `submitted` dengan catatan. Dipanggil di transaksi penulis perubahan, sesudah perubahan ditulis.
 */
export async function reopenForChangedRequirements(tx: Tx, bookingPilgrimId: string, actorId: string, reason: string): Promise<boolean> {
  // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
  const rows = await tx.$queryRaw<{ id: string; reviewStatus: PilgrimReviewStatus }[]>`
    SELECT "id", "reviewStatus" FROM "booking_pilgrims" WHERE "id" = ${bookingPilgrimId} AND "reviewStatus" = 'verified' FOR UPDATE`
  const r = rows[0]
  if (!r) return false
  await tx.bookingPilgrim.update({ where: { id: r.id }, data: { reviewStatus: 'submitted', verifiedAt: null, verifiedById: null }, select: { id: true } })
  await tx.pilgrimReviewEvent.create({ data: { bookingPilgrimId: r.id, fromStatus: r.reviewStatus, toStatus: 'submitted', actorId, note: reason } })
  return true
}

// ── Bacaan ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ReviewEventView = {
  id: string; from: PilgrimReviewStatus | null; to: PilgrimReviewStatus; note: string | null; byStaff: boolean; actorName: string | null; at: string
  /** Kejadian ini dilakukan petugas yang sedang melihat (hanya `forStaff`) — dasar pengingat pemisahan tugas. */
  byViewer: boolean
}

/**
 * Riwayat pengajuan per jamaah booking (terbaru dulu). `forStaff=false` (halaman pemesan): nama petugas tidak dikirim; catatan tetap (ditujukan
 * ke pemesan). Pemanggil sudah memastikan jamaah-jamaah ini milik booking yang boleh dilihat. `viewerId` (staf) menandai kejadian miliknya
 * (`byViewer`) untuk pengingat pemisahan tugas — hanya mengingatkan, tidak memblokir (keputusan pemilik 2026-11-03).
 */
export async function reviewHistoryOf(bookingPilgrimIds: readonly string[], forStaff: boolean, viewerId?: string): Promise<Map<string, ReviewEventView[]>> {
  const out = new Map<string, ReviewEventView[]>(bookingPilgrimIds.map(id => [id, []]))
  if (bookingPilgrimIds.length === 0) return out
  const rows = await prisma.pilgrimReviewEvent.findMany({
    where: { bookingPilgrimId: { in: [...bookingPilgrimIds] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50 * bookingPilgrimIds.length,
    select: { id: true, bookingPilgrimId: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actorId: true, actor: { select: { role: true, fullName: true } } },
  })
  for (const r of rows) {
    const staff = !!r.actor && ADMIN_ROLES.includes(r.actor.role)
    out.get(r.bookingPilgrimId)?.push({
      id: r.id, from: r.fromStatus, to: r.toStatus, note: r.note, byStaff: staff,
      actorName: forStaff ? (r.actor?.fullName ?? null) : null, at: r.createdAt.toISOString(),
      byViewer: forStaff && staff && !!viewerId && r.actorId === viewerId,
    })
  }
  return out
}
