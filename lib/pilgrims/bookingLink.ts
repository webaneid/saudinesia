import { Prisma, type PilgrimReviewStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isRetryableConflict, retryConflict } from '@/lib/booking/serializable'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { consume, policy } from '@/lib/auth/rateLimit'
import { formatAddressLine } from '@/lib/address/format'
import { CORE_MANIFEST_PRODUCT_ID, CORE_MANIFEST_PRODUCT_TYPE } from '@/lib/manifest/constants'
import { isSealedRole, snapshotFromCard, type CardForSnapshot } from '@/lib/manifest/roles'
import type { ManifestAddressValue } from '@/lib/manifest/addressValue'
import { resolveAddressValues } from '@/lib/manifest/address'
import { ensurePiiKeysMatch, maskPassport, NIK_MASK, nikProblem, normalizeNik, normalizePassport, sealNik, sealPassport } from '@/lib/pii'
import { calendarDateOf, todayInApp, type CalendarDate } from '@/lib/time'
import { pilgrimRequirements } from '@/lib/documents/requirements'
import { evaluateCompleteness, type CompletenessItem } from '@/lib/documents/completeness'
import { lockCardOwner, type Actor, type ServiceError } from './service'
import { isReviewLocked, REVIEW_LOCKED_MESSAGE } from './reviewState'

// Tautan kartu jamaah tersimpan → jamaah booking (docs/arsitektur-jamaah.md §5.3, Fase 7a) — SATU-SATUNYA penulis `booking_pilgrims.savedPilgrimId`,
// `identityId`, dan kolom NIK/paspor tersegel. Aturan:
// - Kartu WAJIB milik pemilik booking (bukan akun lain; 404 sama dengan "tidak ada"), tidak terarsip; booking bukan draf; akun pemilik aktif.
// - Urutan kunci sama dengan layanan kartu/dokumen: baris `users` pemilik FOR SHARE → baris jamaah booking FOR UPDATE.
// - Snapshot = isi kartu SAAT ditautkan/diperbarui lewat pengikat peran (lib/manifest/roles.ts); mengedit kartu sesudahnya TIDAK mengubah booking.
// - NIK/paspor tak pernah polos di `booking_pilgrims`: ciphertext + indeks disalin apa adanya dari baris kartu (tanpa membuka), isian manual
//   disegel `sealNik`/`sealPassport`; `fieldValues` hanya menyimpan samaran.

type Tx = Prisma.TransactionClient

export { BOOKING_PILGRIM_SAFE_SELECT } from './safeSelect'
export type LinkResult = { ok: true; savedPilgrimId: string | null; fieldValues: Record<string, unknown> } | ServiceError

class Abort extends Error {
  constructor(readonly result: ServiceError) { super(result.error) }
}
const fail = (status: ServiceError['status'], error: string, field?: string): never => { throw new Abort({ ok: false, status, error, ...(field ? { field } : {}) }) }
const notFound = () => fail(404, 'Jamaah tidak ditemukan')
const isStaff = (actor: Actor) => ADMIN_ROLES.includes(actor.role)

const cardSelect = {
  id: true, ownerId: true, identityId: true, archivedAt: true, fullName: true, gender: true, birthPlace: true, birthDate: true, nationality: true,
  nikHash: true, nikCipher: true, passportKeyHash: true, passportCipher: true, passportLast4: true, passportIssuedAt: true, passportExpiry: true,
  phone: true, whatsapp: true, email: true,
  address: { select: { type: true, fullAddress: true, postalCode: true, city: true, stateRegion: true, countryCode: true,
    provinceId: true, regencyId: true, districtId: true, villageId: true,
    village: { select: { name: true } }, district: { select: { name: true } }, regency: { select: { name: true } }, province: { select: { name: true } } } },
} satisfies Prisma.SavedPilgrimSelect
type CardRow = Prisma.SavedPilgrimGetPayload<{ select: typeof cardSelect }>

const cal = (d: Date | null) => (d ? calendarDateOf(d) : null)
const forSnapshot = (c: CardRow): CardForSnapshot => ({
  fullName: c.fullName, gender: c.gender, birthPlace: c.birthPlace, birthDate: cal(c.birthDate), nationality: c.nationality,
  hasNik: c.nikHash !== null, passportLast4: c.passportLast4, passportIssuedAt: cal(c.passportIssuedAt), passportExpiry: cal(c.passportExpiry),
  phone: c.phone, whatsapp: c.whatsapp, email: c.email, address: addressOf(c.address),
})
function addressOf(a: CardRow['address']): ManifestAddressValue | null {
  if (!a) return null
  return {
    type: a.type, fullAddress: a.fullAddress, postalCode: a.postalCode, provinceId: a.provinceId, regencyId: a.regencyId, districtId: a.districtId,
    villageId: a.villageId, countryCode: a.countryCode, city: a.city, stateRegion: a.stateRegion, text: formatAddressLine(a),
  }
}

/** Field manifest jamaah: produk visa-nya, atau `core` bila tanpa visa (aturan yang sama dengan route data jamaah). */
export function manifestFieldsOf(db: Tx | typeof prisma, visaProductId: string | null | undefined) {
  return db.manifestFieldRequirement.findMany({
    where: visaProductId ? { productType: 'visa', productId: visaProductId } : { productType: CORE_MANIFEST_PRODUCT_TYPE, productId: CORE_MANIFEST_PRODUCT_ID },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  })
}

type Locked = { id: string; bookingId: string; ownerId: string; savedPilgrimId: string | null; fieldValues: Record<string, unknown>; visaProductId: string | null }

/** Kunci pemilik booking (FOR SHARE) lalu jamaah booking (FOR UPDATE). Jamaah harus milik `bookingId`, booking bukan draf. */
async function lockBookingPilgrim(tx: Tx, actor: Actor, bookingId: string, bookingPilgrimId: string): Promise<Locked> {
  const head = await tx.bookingPilgrim.findFirst({
    where: { id: bookingPilgrimId, bookingId, booking: { status: { not: 'draft' } } },
    select: { booking: { select: { userId: true } } },
  })
  if (!head) return notFound()
  const ownerId = head.booking.userId
  if (!isStaff(actor) && actor.userId !== ownerId) return notFound()
  const refusal = await lockCardOwner(tx, actor, ownerId)
  if (refusal) throw new Abort(refusal.status === 404 ? { ok: false, status: 404, error: 'Jamaah tidak ditemukan' } : refusal)
  // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
  const rows = await tx.$queryRaw<{ savedPilgrimId: string | null; fieldValues: unknown; reviewStatus: PilgrimReviewStatus }[]>`
    SELECT "savedPilgrimId", "fieldValues", "reviewStatus" FROM "booking_pilgrims" WHERE "id" = ${bookingPilgrimId} AND "bookingId" = ${bookingId} FOR UPDATE`
  const row = rows[0]
  if (!row) return notFound()
  // Diajukan/terverifikasi (Fase 6): ditolak SEBELUM mengunci kartu — urutan kunci layanan dokumen (kartu → jamaah booking) tetap aman.
  if (isReviewLocked(row.reviewStatus)) return fail(409, REVIEW_LOCKED_MESSAGE)
  const visa = await tx.visaApplication.findUnique({ where: { bookingPilgrimId }, select: { visaProductId: true } })
  return { id: bookingPilgrimId, bookingId, ownerId, savedPilgrimId: row.savedPilgrimId, fieldValues: (row.fieldValues ?? {}) as Record<string, unknown>, visaProductId: visa?.visaProductId ?? null }
}

async function rateLimited(actor: Actor): Promise<ServiceError | null> {
  const hit = await consume(policy(isStaff(actor) ? 'pilgrimWriteStaff' : 'pilgrimWriteUser', actor.userId))
  return hit.allowed ? null : { ok: false, status: 429, error: 'Terlalu banyak perubahan data jamaah. Coba lagi nanti.', retryAfterSec: hit.retryAfterSec }
}

async function run(actor: Actor, fn: (tx: Tx) => Promise<LinkResult>): Promise<LinkResult> {
  const limited = await rateLimited(actor)
  if (limited) return limited
  try {
    return await retryConflict(() => prisma.$transaction(fn)) // deadlock dengan gabung identitas (F8, SEC-205) → ulang
  } catch (e) {
    if (e instanceof Abort) return e.result
    if (isRetryableConflict(e)) return { ok: false, status: 409, error: 'Data jamaah sedang diubah bersamaan — coba lagi' }
    // Balapan dua jamaah menautkan kartu yang sama (indeks unik bookingId+savedPilgrimId) → sama dengan cek kembar.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, status: 409, error: 'Data jamaah ini sudah dipakai jamaah lain di booking yang sama', field: 'cardId' }
    throw e
  }
}

/** Tautkan kartu (atau perbarui snapshot dari kartu yang sama): isi field berperan dari kartu, salin NIK/paspor tersegel. */
export function linkCard(actor: Actor, bookingId: string, bookingPilgrimId: string, cardId: string): Promise<LinkResult> {
  return run(actor, async (tx) => {
    const bp = await lockBookingPilgrim(tx, actor, bookingId, bookingPilgrimId)
    // Ganti ke kartu LAIN: dokumen perjalanan kartu lama akan tertinggal tak terlihat — aturan yang sama dengan lepas tautan.
    if (bp.savedPilgrimId && bp.savedPilgrimId !== cardId) await refuseTripDocs(tx, bookingId, bp.savedPilgrimId)
    // Kunci kartu (FOR SHARE) supaya tak dihapus/dipindah identitasnya di tengah — snapshot dan segel dari versi yang sama. $queryRaw: tak ada FOR SHARE di ORM.
    const held = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "saved_pilgrims" WHERE "id" = ${cardId} AND "ownerId" = ${bp.ownerId} FOR SHARE`
    const card = held[0] ? await tx.savedPilgrim.findUnique({ where: { id: cardId }, select: cardSelect }) : null
    if (!card) return fail(404, 'Data jamaah tersimpan tidak ditemukan', 'cardId')
    if (card.archivedAt) return fail(409, 'Data jamaah ini diarsipkan — pulihkan dulu sebelum dipakai', 'cardId')
    const twin = await tx.bookingPilgrim.findFirst({ where: { bookingId, savedPilgrimId: cardId, id: { not: bookingPilgrimId } }, select: { id: true } })
    if (twin) return fail(409, 'Data jamaah ini sudah dipakai jamaah lain di booking yang sama', 'cardId')
    const fields = await manifestFieldsOf(tx, bp.visaProductId)
    const fieldValues = { ...bp.fieldValues, ...snapshotFromCard(fields, forSnapshot(card)) }
    await tx.bookingPilgrim.update({
      where: { id: bookingPilgrimId },
      data: {
        savedPilgrimId: card.id, identityId: card.identityId, fieldValues: fieldValues as Prisma.InputJsonValue,
        nikHash: card.nikHash, nikCipher: card.nikCipher,
        passportCountry: card.passportCipher ? card.nationality : null, passportKeyHash: card.passportKeyHash,
        passportCipher: card.passportCipher, passportLast4: card.passportLast4,
      },
      select: { id: true },
    })
    return { ok: true, savedPilgrimId: card.id, fieldValues }
  })
}

async function refuseTripDocs(tx: Tx, bookingId: string, cardId: string) {
  const tripDocs = await tx.pilgrimDocument.count({ where: { bookingId, savedPilgrimId: cardId } })
  if (tripDocs > 0) fail(409, 'Hapus dulu dokumen perjalanan jamaah ini sebelum melepas atau mengganti data jamaah tersimpan')
}

/** Lepas tautan kartu — snapshot (termasuk segel) TETAP. Ditolak bila kartu masih memegang dokumen perjalanan booking ini. */
export function unlinkCard(actor: Actor, bookingId: string, bookingPilgrimId: string): Promise<LinkResult> {
  return run(actor, async (tx) => {
    const bp = await lockBookingPilgrim(tx, actor, bookingId, bookingPilgrimId)
    if (!bp.savedPilgrimId) return fail(409, 'Jamaah ini belum memakai data jamaah tersimpan')
    await refuseTripDocs(tx, bookingId, bp.savedPilgrimId)
    await tx.bookingPilgrim.update({ where: { id: bookingPilgrimId }, data: { savedPilgrimId: null, identityId: null }, select: { id: true } })
    return { ok: true, savedPilgrimId: null, fieldValues: bp.fieldValues }
  })
}

/** KOSONGKAN slot jamaah (aksi "Hapus" di tabel jamaah, pemilik 2026-11-10): lepas kartu DAN hapus isian + segel NIK/paspor — slot tetap ada
 *  karena jumlah jamaah terikat ke tagihan (mengurangi orang = revisi booking oleh admin). Aturan kunci sama dengan lepas: ditolak selama
 *  diajukan/terverifikasi dan bila kartu masih memegang dokumen perjalanan booking ini (dokumen dihapus dulu, tidak diam-diam). */
export function clearSlot(actor: Actor, bookingId: string, bookingPilgrimId: string): Promise<LinkResult> {
  return run(actor, async (tx) => {
    const bp = await lockBookingPilgrim(tx, actor, bookingId, bookingPilgrimId)
    if (bp.savedPilgrimId) await refuseTripDocs(tx, bookingId, bp.savedPilgrimId)
    await tx.bookingPilgrim.update({
      where: { id: bookingPilgrimId },
      data: {
        savedPilgrimId: null, identityId: null, fieldValues: {},
        nikHash: null, nikCipher: null, passportCountry: null, passportKeyHash: null, passportCipher: null, passportLast4: null,
      },
      select: { id: true },
    })
    return { ok: true, savedPilgrimId: null, fieldValues: {} }
  })
}

// ── Isian manual NIK/paspor (formulir data jamaah) ─────────────────────────────────────────────────────────────────────────────────────

type SealedColumns = Partial<Record<'nikHash' | 'nikCipher' | 'passportCountry' | 'passportKeyHash' | 'passportCipher' | 'passportLast4', string | null>>
export type ManualPii = { ok: true; values: Record<string, unknown>; columns: SealedColumns } | { ok: false; errors: Record<string, string> }
type FieldLite = { fieldKey: string; label: string; role: string | null }

/**
 * Field berperan `nik`/`passport_number` dari isian admin (sudah lolos `validateFieldValues`): nilai = samaran saat ini → tidak diubah; kosong →
 * segel dihapus; selain itu dinormalisasi lalu DISEGEL, dan `values` diganti samarannya. Negara paspor = kebangsaan kartu tertaut, bawaan `ID`.
 */
export async function sealManualPii(fields: readonly FieldLite[], values: Record<string, unknown>, passportCountry: string, db: Pick<typeof prisma, 'piiKeyCheck'> = prisma): Promise<ManualPii> {
  const out = { ...values }
  const columns: SealedColumns = {}
  const errors: Record<string, string> = {}
  for (const f of fields) {
    if (!isSealedRole(f.role) || !(f.fieldKey in values)) continue
    const raw = values[f.fieldKey]
    if (raw === null || raw === '') {
      if (f.role === 'nik') Object.assign(columns, { nikHash: null, nikCipher: null })
      else Object.assign(columns, { passportCountry: null, passportKeyHash: null, passportCipher: null, passportLast4: null })
      out[f.fieldKey] = null
      continue
    }
    if (typeof raw !== 'string') { errors[f.fieldKey] = `${f.label} tidak valid`; continue }
    if (f.role === 'nik') {
      if (raw === NIK_MASK) { delete out[f.fieldKey]; continue }
      const nik = normalizeNik(raw)
      const problem = nik ? null : nikProblem(raw.replace(/[\s.\-]/g, ''))
      if (problem || !nik) { errors[f.fieldKey] = problem ?? `${f.label} tidak valid`; continue }
      await ensurePiiKeysMatch(db)
      const s = sealNik(nik)
      Object.assign(columns, { nikHash: s.hash, nikCipher: s.cipher })
      out[f.fieldKey] = NIK_MASK
    } else {
      if (/^•+[A-Z0-9]{4}$/.test(raw)) { delete out[f.fieldKey]; continue }
      const number = normalizePassport(raw)
      if (!number) { errors[f.fieldKey] = `${f.label}: 5–20 huruf/angka`; continue }
      await ensurePiiKeysMatch(db)
      const s = sealPassport(passportCountry, number)
      Object.assign(columns, { passportCountry, passportKeyHash: s.keyHash, passportCipher: s.cipher, passportLast4: s.last4 })
      out[f.fieldKey] = maskPassport(s.last4)
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: out, columns }
}

/** Negara paspor isian manual: kebangsaan kartu tertaut, lalu field berperan `nationality` bila berupa kode ISO, bawaan `ID`. */
export function passportCountryOf(fields: readonly FieldLite[], values: Record<string, unknown>, cardNationality?: string | null): string {
  if (cardNationality) return cardNationality
  const nat = fields.find(f => f.role === 'nationality')
  const raw = nat ? values[nat.fieldKey] : null
  return typeof raw === 'string' && /^[A-Z]{2}$/.test(raw) ? raw : 'ID'
}

/** Jamaah booking BARU (checkout/booking admin, lib/booking/lineItems.ts): alamat dibekukan, field `nik`/`passport_number` disegel sebelum ditulis. */
export async function sealNewPilgrim(tx: Tx, visaProductId: string | null, values: Record<string, unknown>): Promise<ManualPii> {
  const fields = await manifestFieldsOf(tx, visaProductId)
  const addressed = await resolveAddressValues(fields, values, tx) // alamat dibekukan dengan `text` dari DB (D1)
  if (!addressed.ok) return addressed
  return sealManualPii(fields, addressed.values, passportCountryOf(fields, addressed.values), tx)
}

/**
 * Jamaah hanya MENAMBAH data/berkas pada booking `active` (minimisasi data UU PDP: booking batal/hangus/selesai tak menerima PII atau berkas baru);
 * lihat, hapus, dan lepas tetap terbuka. `missing` = bukan booking akun ini (route menjawab 404 lewat layanan, tanpa orakel).
 */
export async function pilgrimBookingState(bookingId: string, userId: string): Promise<'open' | 'closed' | 'missing'> {
  const b = await prisma.booking.findFirst({ where: { id: bookingId, userId, status: { not: 'draft' } }, select: { status: true } })
  return !b ? 'missing' : b.status === 'active' ? 'open' : 'closed'
}

/** Cakupan dokumen perjalanan satu jamaah booking: pemilik booking + kartu tertaut; `null` bila tak ada / draf / belum tertaut (404 yang sama). */
export async function tripScopeOf(bookingId: string, bookingPilgrimId: string): Promise<{ ownerId: string; cardId: string } | null> {
  const bp = await prisma.bookingPilgrim.findFirst({
    where: { id: bookingPilgrimId, bookingId, booking: { status: { not: 'draft' } } },
    select: { savedPilgrimId: true, booking: { select: { userId: true } } },
  })
  return bp?.savedPilgrimId ? { ownerId: bp.booking.userId, cardId: bp.savedPilgrimId } : null
}

/** Berkas jamaah untuk jenis yang disyaratkan (bahan pemeriksaan petugas, Fase 6). Tanpa kunci objek — dilihat lewat URL presigned. */
export type ChecklistDocument = {
  id: string; documentTypeId: string; label: string; trip: boolean; status: 'pending' | 'accepted' | 'rejected'
  rejectReason: 'not_matching' | 'expired' | 'unreadable' | 'other' | null; reviewNote: string | null; expiresAt: CalendarDate | null
}

/**
 * Kelengkapan dokumen jamaah booking (§5.3 butir 5): syarat = gabungan syarat produk yang memuatnya (`pilgrimRequirements`: Paket → Haji → Visa); berkas = dokumen milik orang di kartu tertaut + dokumen
 * perjalanan booking ini. Jamaah tanpa kartu tertaut: semua syarat `missing`. Tanggal acuan = rencana berangkat visa → tanggal acuan booking → hari ini.
 */
export async function bookingChecklists(
  bookingId: string,
  bookingDate: CalendarDate | null,
  pilgrims: readonly { id: string; savedPilgrimId: string | null; plannedTravelDate: CalendarDate | null }[],
): Promise<Map<string, { card: { id: string; name: string } | null; items: CompletenessItem[]; ready: boolean; verified: boolean; documents: ChecklistDocument[] }>> {
  const reqs = await pilgrimRequirements(prisma, pilgrims.map(p => p.id))
  const cardIds = [...new Set(pilgrims.flatMap(p => (p.savedPilgrimId ? [p.savedPilgrimId] : [])))]
  const [cards, docs] = cardIds.length
    ? await Promise.all([
        prisma.savedPilgrim.findMany({ where: { id: { in: cardIds } }, select: { id: true, fullName: true } }),
        prisma.pilgrimDocument.findMany({
          where: { savedPilgrimId: { in: cardIds }, OR: [{ bookingId: null }, { bookingId }] },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, savedPilgrimId: true, bookingId: true, documentTypeId: true, label: true, status: true, rejectReason: true, reviewNote: true, expiresAt: true },
        }),
      ])
    : [[], []]
  const nameOf = new Map(cards.map(c => [c.id, c.fullName]))
  const today = todayInApp()
  return new Map(pilgrims.map(p => {
    const requirements = reqs.get(p.id) ?? []
    const typeIds = new Set(requirements.map(r => r.documentTypeId))
    const own = docs.filter(d => d.savedPilgrimId === p.savedPilgrimId)
    const documents = own.map(d => ({ documentTypeId: d.documentTypeId, status: d.status, expiresAt: d.expiresAt ? calendarDateOf(d.expiresAt) : null }))
    const c = evaluateCompleteness({ requirements, documents, referenceDate: p.plannedTravelDate ?? bookingDate ?? today })
    const card = p.savedPilgrimId ? { id: p.savedPilgrimId, name: nameOf.get(p.savedPilgrimId) ?? 'Jamaah' } : null
    const listed = own.filter(d => typeIds.has(d.documentTypeId)).map((d): ChecklistDocument => ({
      id: d.id, documentTypeId: d.documentTypeId, label: d.label, trip: d.bookingId !== null, status: d.status, rejectReason: d.rejectReason,
      reviewNote: d.reviewNote, expiresAt: d.expiresAt ? calendarDateOf(d.expiresAt) : null,
    }))
    return [p.id, { card, items: c.items, ready: c.ready, verified: c.verified, documents: listed }]
  }))
}
