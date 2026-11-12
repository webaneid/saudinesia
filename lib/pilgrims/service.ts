import { Prisma, type Gender, type UserRole } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertAddress } from '@/lib/address/prepare'
import { codedError, codeOfText, type ApiErrorCode } from '@/lib/errors/api'
import type { ApiErrorParams } from '@/lib/errors/params'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { consume, policy } from '@/lib/auth/rateLimit'
import { ensurePiiKeysMatch, maskPassport, NIK_MASK, nikHints, nikProblem, nikProvinceCode, normalizeNik, normalizePassport, sealNik, sealPassport, type NikHint } from '@/lib/pii'
import { calendarDateOf, dbDateOf, todayInApp, type CalendarDate } from '@/lib/time'
import { paginate, type ListParams, type PageMeta } from '@/lib/table/pagination'
import { escapeLike } from '@/lib/utils/search'
import type { SavedPilgrimInput } from '@/lib/validators/pilgrims'
import { nameKeyOf } from './nameKey'
import { deleteDocumentRowsOfCards, documentKeysOfCards } from '@/lib/documents/purge'
import { cardDocPrefix, minioDocumentStorage, removeObjectsQuietly } from '@/lib/documents/storage'

// SATU-SATUNYA penulis kartu jamaah (SavedPilgrim) dan gudang identitas (PilgrimIdentity) — docs/arsitektur-jamaah.md §4, ADR-0005.
// Aturan inti:
// - Respons ke pemilik kartu IDENTIK apakah NIK baru, sudah dimiliki akun lain, atau konflik: DTO hanya berisi isi kartunya sendiri
//   (tanpa identityId/matchStatus), peringatan hanya diturunkan dari masukan pengguna sendiri. Satu-satunya penolakan terkait NIK:
//   NIK yang sama sudah ada di daftar AKUN ITU SENDIRI.
// - Setiap operasi yang menyentuh satu identitas memegang advisory lock atas KUNCI identitas itu (hash NIK / hash paspor) — satu namespace,
//   jadi buat-tautkan dan lepas-pangkas pada orang yang sama selalu berurutan (dua akun menyimpan NIK sama serentak → satu identitas).
// - Data kanonik identitas yang belum pernah terverifikasi mengikuti kartu tertua yang menautnya; sesudah terverifikasi (Fase 6) hanya
//   pengajuan terverifikasi yang mengubahnya. Identitas tanpa kartu dan tanpa riwayat booking dihapus (tak ada NIK yatim).

export type Actor = { userId: string; role: UserRole }
export type PilgrimWarning = NikHint | 'province_unknown'

export type SavedPilgrimView = {
  id: string
  fullName: string
  gender: Gender | null
  birthPlace: string | null
  birthDate: CalendarDate | null
  nationality: string
  /** NIK selalu tersamar penuh (SEC-165); `null` = belum ada NIK. */
  nik: string | null
  passport: { number: string; issuedAt: CalendarDate | null; expiry: CalendarDate | null } | null
  addressId: string | null
  /** Alamat kartu ini sendiri (untuk AddressPicker saat mengubah); bukan data akun lain. */
  address: SavedPilgrimAddress | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  isSelf: boolean
  archived: boolean
  /** Petugas meminta pemilik memeriksa ulang NIK (Fase 8) — pesan generik, tak menyebut data akun lain; hilang setelah NIK diubah. */
  needsNikCheck: boolean
  createdAt: string
  updatedAt: string
}

export type SavedPilgrimAddress = {
  type: 'domestic' | 'international'
  fullAddress: string
  postalCode: string | null
  provinceId: string | null
  regencyId: string | null
  districtId: string | null
  villageId: string | null
  countryCode: string | null
  city: string | null
  stateRegion: string | null
}

/** `error` = teks Indonesia (admin); `code`/`params` = kunci `apiErrors` untuk pelanggan (docs/arsitektur-i18n-frontend.md §6.6). */
export type ServiceError = { ok: false; status: 400 | 404 | 409 | 422 | 429; error: string; code?: ApiErrorCode; params?: ApiErrorParams; field?: string; retryAfterSec?: number }
export type WriteResult = { ok: true; card: SavedPilgrimView; warnings: PilgrimWarning[] } | ServiceError
export type DeleteResult = { ok: true; result: 'deleted' | 'archived' } | ServiceError

const viewSelect = {
  id: true, fullName: true, gender: true, birthPlace: true, birthDate: true, nationality: true, nikHash: true,
  passportLast4: true, passportIssuedAt: true, passportExpiry: true, addressId: true, phone: true, whatsapp: true, email: true,
  selfOfUserId: true, archivedAt: true, nikCheckRequestedAt: true, createdAt: true, updatedAt: true,
  address: { select: { type: true, fullAddress: true, postalCode: true, provinceId: true, regencyId: true, districtId: true, villageId: true, countryCode: true, city: true, stateRegion: true } },
} satisfies Prisma.SavedPilgrimSelect

type ViewRow = Prisma.SavedPilgrimGetPayload<{ select: typeof viewSelect }>

const cal = (d: Date | null): CalendarDate | null => (d ? calendarDateOf(d) : null)

function toView(r: ViewRow): SavedPilgrimView {
  return {
    id: r.id, fullName: r.fullName, gender: r.gender, birthPlace: r.birthPlace, birthDate: cal(r.birthDate), nationality: r.nationality,
    nik: r.nikHash ? NIK_MASK : null,
    passport: r.passportLast4 ? { number: maskPassport(r.passportLast4), issuedAt: cal(r.passportIssuedAt), expiry: cal(r.passportExpiry) } : null,
    addressId: r.addressId, address: r.address, phone: r.phone, whatsapp: r.whatsapp, email: r.email,
    isSelf: r.selfOfUserId !== null, archived: r.archivedAt !== null, needsNikCheck: r.nikCheckRequestedAt !== null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }
}

class Abort extends Error {
  constructor(readonly result: ServiceError) { super(result.error) }
}
function fail(status: ServiceError['status'], code: ApiErrorCode, field?: string): never {
  throw new Abort({ ok: false, status, ...codedError(code), ...(field ? { field } : {}) })
}

type Tx = Prisma.TransactionClient
const isStaff = (actor: Actor) => ADMIN_ROLES.includes(actor.role)

/** Pemilik kartu = akun jamaah aktif yang belum dihapus. Dikunci FOR SHARE: penghapusan akun (FOR UPDATE) menunggu, dan sebaliknya. */
async function lockOwner(tx: Tx, actor: Actor, ownerId: string): Promise<void> {
  if (actor.userId !== ownerId && !isStaff(actor)) fail(404, 'pilgrimNotFound')
  // $queryRaw: Prisma ORM tidak punya SELECT ... FOR SHARE.
  const rows = await tx.$queryRaw<{ role: string; isActive: boolean; email: string }[]>`SELECT "role"::text AS "role", "isActive", "email" FROM "users" WHERE "id" = ${ownerId} FOR SHARE`
  const u = rows[0]
  if (!u) fail(404, 'pilgrimNotFound')
  else if (u.role !== 'pilgrim' || !u.isActive || (u.email.startsWith('deleted-') && u.email.endsWith('@deleted.invalid'))) fail(422, 'customerInactive')
}

/** `lockOwner` untuk layanan lain yang menulis data milik kartu (dokumen, lib/documents/service.ts): galat dikembalikan, bukan dilempar. */
export async function lockCardOwner(tx: Tx, actor: Actor, ownerId: string): Promise<ServiceError | null> {
  try { await lockOwner(tx, actor, ownerId); return null } catch (e) {
    if (e instanceof Abort) return e.result
    throw e
  }
}

/** Kunci per identitas (hash NIK / hash paspor), diurutkan supaya dua transaksi yang mengunci dua identitas yang sama tak saling menunggu.
 *  Yang dikunci selalu KUNCI UTAMA identitas (atau kunci yang akan menjadi kunci utama) — kunci alias (Fase 8) dipetakan dulu ke kunci utamanya. */
export async function lockIdentityKeys(tx: Tx, keys: (string | null | undefined)[]): Promise<void> {
  for (const k of [...new Set(keys.filter((x): x is string => !!x))].sort()) {
    // $executeRaw: advisory lock transaksi tidak bisa dinyatakan lewat Prisma ORM.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pilgrim-identity:${k}`}, 0))`
  }
}

/** Umur < 2 tahun pada hari ini (zona aplikasi) — satu-satunya pengecualian NIK wajib bagi WNI (K2). */
function isBaby(birthDate: CalendarDate, today: CalendarDate = todayInApp()): boolean {
  const [y, m, d] = today.split('-')
  const back = `${Number(y) - 2}-${m}-${d}`
  const cutoff = m === '02' && d === '29' ? `${Number(y) - 2}-03-01` : back // 29 Feb tak ada 2 tahun lalu
  return birthDate > cutoff
}

type IdentityKey = { kind: 'nik'; hash: string; cipher: string } | { kind: 'passport'; hash: string }

/** Kunci utama identitas (hash NIK, atau hash paspor untuk WNA) — satu-satunya kunci advisory identitas itu. */
export const primaryKeyOf = (i: { nikHash: string | null; passportKeyHash: string | null }): string | null => i.nikHash ?? i.passportKeyHash

/** Identitas pemilik kunci ini lewat kunci utama ATAU alias gabungan (Fase 8). Dibaca tanpa kunci; pemanggil mengunci `primary` lalu membaca ulang. */
async function identityByKey(tx: Tx, key: IdentityKey): Promise<{ id: string; primary: string } | null> {
  const sel = { id: true, nikHash: true, passportKeyHash: true } as const
  const direct = await tx.pilgrimIdentity.findUnique({ where: key.kind === 'nik' ? { nikHash: key.hash } : { passportKeyHash: key.hash }, select: sel })
  const found = direct ?? (await tx.pilgrimIdentityAlias.findUnique({ where: { keyHash: key.hash }, select: { identity: { select: sel } } }))?.identity ?? null
  return found ? { id: found.id, primary: primaryKeyOf(found)! } : null
}

type Resolved = {
  nik: { hash: string; cipher: string } | null
  passport: { keyHash: string; cipher: string; last4: string; issuedAt: CalendarDate | null; expiry: CalendarDate | null } | null
  newNik: ReturnType<typeof normalizeNik>
}

type Existing = { nikHash: string | null; nikCipher: string | null; nationality: string; passportKeyHash: string | null; passportCipher: string | null; passportLast4: string | null; passportIssuedAt: Date | null; passportExpiry: Date | null }

/** Gabungkan masukan dengan isi lama (undefined = tetap) lalu terapkan aturan kewarganegaraan. Melempar Abort bila tak sah. */
function resolvePii(input: SavedPilgrimInput, existing: Existing | null): Resolved {
  let nik: Resolved['nik'] = existing?.nikHash && existing.nikCipher ? { hash: existing.nikHash, cipher: existing.nikCipher } : null
  let newNik: Resolved['newNik'] = null
  if (input.nik === null || input.nik?.trim() === '') nik = null
  else if (input.nik !== undefined) {
    newNik = normalizeNik(input.nik)
    if (!newNik) return fail(400, codeOfText(nikProblem(input.nik.replace(/[\s.\-]/g, '')) ?? '') ?? 'nikInvalid', 'nik') // nikProblem: teks (lib/pii), dipetakan ke kode
    nik = sealNik(newNik)
  }

  const nationality = input.nationality
  let passport: Resolved['passport'] = null
  if (input.passport === undefined && existing?.passportKeyHash) {
    if (existing.nationality !== nationality) fail(400, 'passportReenter', 'passport.number')
    passport = { keyHash: existing.passportKeyHash, cipher: existing.passportCipher!, last4: existing.passportLast4!, issuedAt: cal(existing.passportIssuedAt), expiry: cal(existing.passportExpiry) }
  } else if (input.passport) {
    const issuedAt = input.passport.issuedAt ?? null
    const expiry = input.passport.expiry ?? null
    if (issuedAt && expiry && expiry <= issuedAt) fail(400, 'expiryAfterIssue', 'passport.expiry')
    if (input.passport.number === undefined) {
      if (!existing?.passportKeyHash) fail(400, 'passportRequired', 'passport.number')
      if (existing!.nationality !== nationality) fail(400, 'passportReenter', 'passport.number')
      passport = { keyHash: existing!.passportKeyHash!, cipher: existing!.passportCipher!, last4: existing!.passportLast4!, issuedAt, expiry }
    } else {
      const number = normalizePassport(input.passport.number)
      if (!number) fail(400, 'passportFormat', 'passport.number')
      // Negara penerbit paspor = kewarganegaraan (paspor diterbitkan negara warganya).
      passport = { ...sealPassport(nationality, number!), issuedAt, expiry }
    }
  }

  if (input.birthDate > todayInApp()) fail(400, 'birthDateFuture', 'birthDate')
  if (nationality === 'ID') {
    if (!nik && !isBaby(input.birthDate)) fail(400, 'nikRequired', 'nik')
  } else {
    if (nik) fail(400, 'nikOnlyIndonesian', 'nik')
    if (!passport) fail(400, 'passportRequiredForeign', 'passport.number')
  }
  return { nik, passport, newNik }
}

const identityKeyOf = (nationality: string, r: Resolved): IdentityKey | null =>
  nationality === 'ID'
    ? (r.nik ? { kind: 'nik', hash: r.nik.hash, cipher: r.nik.cipher } : null)
    : (r.passport ? { kind: 'passport', hash: r.passport.keyHash } : null)

type Canonical = { fullName: string; nameKey: string; gender: Gender | null; birthPlace: string | null; birthDate: Date | null; nationality: string }

/** Cari (lewat kunci utama atau alias) atau buat identitas untuk kunci ini (pemanggil SUDAH memegang kunci utama hasil `identityByKey`, atau kunci ini). */
async function findOrCreateIdentity(tx: Tx, key: IdentityKey, canonical: Canonical): Promise<{ id: string; created: boolean }> {
  const found = await identityByKey(tx, key)
  if (found) return { id: found.id, created: false }
  const data = key.kind === 'nik' ? { nikHash: key.hash, nikCipher: key.cipher } : { passportKeyHash: key.hash }
  const created = await tx.pilgrimIdentity.create({ data: { ...data, ...canonical }, select: { id: true } })
  return { id: created.id, created: true }
}

const sameDate = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null)

/**
 * Rapikan satu identitas sesudah kartu berubah/terlepas (pemanggil memegang kunci identitasnya): tanpa kartu & tanpa riwayat booking → dihapus;
 * belum terverifikasi → data kanonik = kartu tertua; status setiap kartu dihitung ulang (cocok nama ternormalisasi + tanggal lahir → matched).
 */
export async function settleIdentity(tx: Tx, identityId: string, actorId: string | null): Promise<'deleted' | 'kept'> {
  const identity = await tx.pilgrimIdentity.findUnique({
    where: { id: identityId },
    select: { id: true, nameKey: true, birthDate: true, fullName: true, gender: true, birthPlace: true, nationality: true, lastVerifiedAt: true, canonicalPinnedAt: true, _count: { select: { bookingPilgrims: true } } },
  })
  if (!identity) return 'deleted'
  const cards = await tx.savedPilgrim.findMany({
    where: { identityId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, matchStatus: true, matchConfirmedAt: true, updatedAt: true, fullName: true, nameKey: true, gender: true, birthPlace: true, birthDate: true, nationality: true },
  })
  if (cards.length === 0 && identity._count.bookingPilgrims === 0) {
    await tx.pilgrimIdentity.delete({ where: { id: identityId } }) // jejak ikut terhapus (Cascade): tak ada NIK yatim
    return 'deleted'
  }
  let canon = { nameKey: identity.nameKey, birthDate: identity.birthDate }
  const source = cards[0]
  // Kanonik dari kartu tertua hanya selama belum terverifikasi (F6) dan belum ditetapkan admin (F8).
  if (identity.lastVerifiedAt === null && identity.canonicalPinnedAt === null && source) {
    const next = { fullName: source.fullName, nameKey: source.nameKey, gender: source.gender, birthPlace: source.birthPlace, birthDate: source.birthDate, nationality: source.nationality }
    const changed = next.fullName !== identity.fullName || next.nameKey !== identity.nameKey || next.gender !== identity.gender
      || next.birthPlace !== identity.birthPlace || !sameDate(next.birthDate, identity.birthDate) || next.nationality !== identity.nationality
    if (changed) {
      await tx.pilgrimIdentity.update({ where: { id: identityId }, data: next })
      await tx.pilgrimIdentityEvent.create({ data: { identityId, actorId, kind: 'canonical_updated', cardId: source.id, detail: { source: 'oldest_card' } } })
    }
    canon = { nameKey: next.nameKey, birthDate: next.birthDate }
  }
  for (const c of cards) {
    // Cocok manual petugas (F8) menang sampai kartu itu diubah (write() menggugurkan matchConfirmedAt).
    const status = c.matchConfirmedAt || (c.nameKey === canon.nameKey && sameDate(c.birthDate, canon.birthDate)) ? 'matched' : 'conflict'
    // updatedAt TIDAK boleh bergeser karena status (SEC-173): ia tampil ke pemilik kartu, dan pergeseran itu membuka bahwa NIK-nya juga
    // ada di akun lain (kartu baru: 'matched'→'conflict' sesudah dibuat; kartu korban: berubah saat akun lain menyimpan NIK yang sama).
    if (status !== c.matchStatus) await tx.savedPilgrim.update({ where: { id: c.id }, data: { matchStatus: status, updatedAt: c.updatedAt } })
  }
  return 'kept'
}

export type VerifiedCanonical = { fullName?: string; gender?: Gender; birthPlace?: string; birthDate?: CalendarDate; nationality?: string }

/**
 * Pengajuan jamaah booking TERVERIFIKASI (Fase 6, lib/pilgrims/review.ts) → data kanonik identitas = data yang diverifikasi petugas (atribut yang
 * tak ada di snapshot tetap), `lastVerifiedAt` diisi (sejak itu kartu tak lagi menggeser kanonik). Pemanggil memegang kunci baris jamaah booking;
 * di sini kunci identitas diambil SESUDAHNYA dan TIDAK menulis baris kartu (status cocok kartu dihitung ulang saat kartu ditulis berikutnya) —
 * menulis kartu sambil memegang baris jamaah booking bisa deadlock dengan layanan dokumen (kartu → jamaah booking).
 */
export async function applyVerifiedSnapshot(tx: Tx, identityId: string, canonical: VerifiedCanonical, actorId: string, bookingPilgrimId: string): Promise<void> {
  const keys = await tx.pilgrimIdentity.findUnique({ where: { id: identityId }, select: { nikHash: true, passportKeyHash: true } })
  if (!keys) return
  await lockIdentityKeys(tx, [keys.nikHash ?? keys.passportKeyHash])
  const data: Prisma.PilgrimIdentityUpdateInput = { lastVerifiedAt: new Date() }
  if (canonical.fullName) Object.assign(data, { fullName: canonical.fullName, nameKey: nameKeyOf(canonical.fullName) })
  if (canonical.gender) data.gender = canonical.gender
  if (canonical.birthPlace) data.birthPlace = canonical.birthPlace
  if (canonical.birthDate) data.birthDate = dbDateOf(canonical.birthDate)
  if (canonical.nationality) data.nationality = canonical.nationality
  await tx.pilgrimIdentity.update({ where: { id: identityId }, data, select: { id: true } })
  // Detail tanpa PII: hanya asal perubahan dan atribut yang dipakai.
  await tx.pilgrimIdentityEvent.create({
    data: { identityId, actorId, kind: 'canonical_updated', detail: { source: 'verified_submission', bookingPilgrimId, fields: Object.keys(canonical).sort() } },
  })
}

async function warningsFor(nik: Resolved['newNik'], input: SavedPilgrimInput): Promise<PilgrimWarning[]> {
  if (!nik) return []
  const out: PilgrimWarning[] = nikHints(nik, { birthDate: input.birthDate, gender: input.gender ?? null })
  const province = await prisma.addressProvince.findUnique({ where: { id: nikProvinceCode(nik) }, select: { id: true } })
  if (!province) out.push('province_unknown')
  return out
}

async function rateLimited(actor: Actor): Promise<ServiceError | null> {
  const hit = await consume(policy(isStaff(actor) ? 'pilgrimWriteStaff' : 'pilgrimWriteUser', actor.userId))
  return hit.allowed ? null : { ok: false, status: 429, ...codedError('tooManyPilgrimChanges'), retryAfterSec: hit.retryAfterSec }
}

/** Galat unik dari balapan yang tak tertangkap pemeriksaan awal (dua permintaan serentak milik akun yang sama). */
function uniqueViolation(e: unknown): ServiceError | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return null
  const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '')
  if (target.includes('selfOfUserId')) return { ok: false, status: 409, ...codedError('selfExists'), field: 'isSelf' }
  if (target.includes('passportKeyHash')) return { ok: false, status: 409, ...codedError('passportExists'), field: 'passport.number' }
  if (target.includes('nikHash')) return { ok: false, status: 409, ...codedError('nikExists'), field: 'nik' }
  return null
}

const existingSelect = {
  id: true, archivedAt: true, identityId: true, addressId: true, selfOfUserId: true, nameKey: true, birthDate: true, matchConfirmedAt: true, nikCheckRequestedAt: true,
  nikHash: true, nikCipher: true, nationality: true, passportKeyHash: true, passportCipher: true, passportLast4: true, passportIssuedAt: true, passportExpiry: true,
} satisfies Prisma.SavedPilgrimSelect

/** Simpan kartu baru (`cardId` null) atau ubah kartu milik `ownerId`. `actor` = pemilik sendiri atau staf (atas nama pelanggan). */
async function write(actor: Actor, ownerId: string, cardId: string | null, input: SavedPilgrimInput): Promise<WriteResult> {
  if (actor.userId !== ownerId && !isStaff(actor)) return { ok: false, status: 404, ...codedError('pilgrimNotFound') }
  const limited = await rateLimited(actor)
  if (limited) return limited
  await ensurePiiKeysMatch() // kunci salah → lempar (500 di route), bukan menulis indeks yang tak cocok dengan data lama

  try {
    const { card, newNik } = await prisma.$transaction(async (tx) => {
      await lockOwner(tx, actor, ownerId)
      // Urutan kunci (SEC-174): kunci identitas SEBELUM kunci baris kartu — settleIdentity mengubah kartu akun LAIN yang menaut identitas yang
      // sama, jadi setiap pemegang kunci baris kartu harus sudah memegang kunci identitasnya (kalau tidak: deadlock antar-akun). Baca dulu tanpa
      // kunci untuk mengetahui kunci identitas, kunci, lalu kunci baris dan pastikan kuncinya tak berubah di sela itu.
      let existing: Prisma.SavedPilgrimGetPayload<{ select: typeof existingSelect }> | null = null
      if (cardId) {
        existing = await tx.savedPilgrim.findFirst({ where: { id: cardId, ownerId }, select: existingSelect })
        if (!existing) fail(404, 'pilgrimNotFound')
      }

      const resolved = resolvePii(input, existing)
      const nationality = input.nationality
      const key = identityKeyOf(nationality, resolved)

      // Fase 8: kartu yang dilepas petugas karena NIK tidak sesuai tak ditautkan ulang otomatis selama kuncinya tak berubah; kartu tanpa kunci
      // (bayi) yang ditautkan petugas tetap tertaut selama masih tanpa kunci.
      const sameKeyAsBefore = !!existing && existing.nikHash === (resolved.nik?.hash ?? null) && existing.passportKeyHash === (resolved.passport?.keyHash ?? null)
      const linkHeld = !!existing?.nikCheckRequestedAt && sameKeyAsBefore
      const adminLink = !key && !!existing?.identityId && !existing.nikHash && !existing.passportKeyHash ? existing.identityId : null
      const wantKey = key && !linkHeld ? key : null

      const oldIdentity = existing?.identityId
        ? await tx.pilgrimIdentity.findUnique({ where: { id: existing.identityId }, select: { id: true, nikHash: true, passportKeyHash: true } })
        : null
      const oldKey = oldIdentity ? primaryKeyOf(oldIdentity) : null
      const target = wantKey ? await identityByKey(tx, wantKey) : null
      const held = [oldKey, target?.primary ?? wantKey?.hash ?? null]
      await lockIdentityKeys(tx, held)
      // Pemetaan kunci → identitas dibaca ulang di dalam kunci: gabung serentak (F8) bisa memindahkannya ke identitas yang kuncinya tak dipegang.
      if (wantKey) {
        const again = await identityByKey(tx, wantKey)
        // Identitas alias yang terhapus di sela itu juga gagal di sini: kunci `wantKey` sendiri tak dipegang (SEC-209).
        if (!held.includes(again?.primary ?? wantKey.hash)) fail(409, 'pilgrimChanged')
      }

      if (cardId && existing) {
        // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE. Menserialkan dua ubah serentak pada kartu yang sama.
        await tx.$queryRaw`SELECT "id" FROM "saved_pilgrims" WHERE "id" = ${cardId} AND "ownerId" = ${ownerId} FOR UPDATE`
        const now = await tx.savedPilgrim.findFirst({ where: { id: cardId, ownerId }, select: existingSelect })
        if (!now) fail(404, 'pilgrimNotFound')
        if (now.identityId !== existing.identityId || now.nikHash !== existing.nikHash || now.passportKeyHash !== existing.passportKeyHash || now.nationality !== existing.nationality
          || !sameDate(now.nikCheckRequestedAt, existing.nikCheckRequestedAt)) {
          fail(409, 'pilgrimChanged')
        }
        if (now.archivedAt) fail(409, 'pilgrimArchivedEdit')
        existing = now
      }

      // NIK/paspor ganda di daftar AKUN INI SENDIRI — satu-satunya penolakan terkait NIK (data miliknya, bukan orakel).
      const dupWhere = (w: Prisma.SavedPilgrimWhereInput) => tx.savedPilgrim.findFirst({ where: { ownerId, ...w, ...(cardId ? { id: { not: cardId } } : {}) }, select: { archivedAt: true } })
      if (resolved.nik) { const d = await dupWhere({ nikHash: resolved.nik.hash }); if (d) fail(409, d.archivedAt ? 'nikExistsArchived' : 'nikExists', 'nik') }
      if (resolved.passport) { const d = await dupWhere({ passportKeyHash: resolved.passport.keyHash }); if (d) fail(409, d.archivedAt ? 'passportExistsArchived' : 'passportExists', 'passport.number') }

      const selfOfUserId = input.isSelf === undefined ? (existing?.selfOfUserId ?? null) : (input.isSelf ? ownerId : null)
      if (selfOfUserId && !existing?.selfOfUserId) {
        const other = await tx.savedPilgrim.findUnique({ where: { selfOfUserId: ownerId }, select: { id: true } })
        if (other) fail(409, 'selfExists', 'isSelf')
      }

      const fullName = input.fullName
      const canonical: Canonical = {
        fullName, nameKey: nameKeyOf(fullName), gender: input.gender ?? null, birthPlace: input.birthPlace ?? null,
        birthDate: dbDateOf(input.birthDate), nationality,
      }
      const identity = wantKey ? await findOrCreateIdentity(tx, wantKey, canonical) : adminLink ? { id: adminLink, created: false } : null
      // Cocok manual petugas gugur begitu kunci, nama ternormalisasi, tanggal lahir, atau identitas kartu berubah.
      const keepConfirm = !!existing?.matchConfirmedAt && sameKeyAsBefore && existing.identityId === (identity?.id ?? null)
        && existing.nameKey === canonical.nameKey && sameDate(existing.birthDate, canonical.birthDate)

      let addressId = existing?.addressId ?? null
      const dropAddress = input.address === null && addressId
      if (input.address) {
        const a = await upsertAddress(addressId, input.address, tx)
        if (!a.ok) fail(400, a.code, 'address')
        else addressId = a.id
      }

      const data = {
        ...canonical,
        identityId: identity?.id ?? null,
        matchStatus: identity ? ('matched' as const) : ('unmatched' as const), // status akhir ditetapkan settleIdentity
        ...(keepConfirm ? {} : { matchConfirmedAt: null, matchConfirmedById: null }),
        nikCheckRequestedAt: linkHeld ? existing!.nikCheckRequestedAt : null,
        selfOfUserId,
        nikHash: resolved.nik?.hash ?? null, nikCipher: resolved.nik?.cipher ?? null,
        passportKeyHash: resolved.passport?.keyHash ?? null, passportCipher: resolved.passport?.cipher ?? null, passportLast4: resolved.passport?.last4 ?? null,
        passportIssuedAt: resolved.passport?.issuedAt ? dbDateOf(resolved.passport.issuedAt) : null,
        passportExpiry: resolved.passport?.expiry ? dbDateOf(resolved.passport.expiry) : null,
        addressId: dropAddress ? null : addressId,
        phone: input.phone === undefined ? undefined : input.phone,
        whatsapp: input.whatsapp === undefined ? undefined : input.whatsapp,
        email: input.email === undefined ? undefined : input.email,
      }
      const saved = cardId
        ? await tx.savedPilgrim.update({ where: { id: cardId }, data, select: { id: true } })
        : await tx.savedPilgrim.create({ data: { ...data, ownerId, createdById: actor.userId === ownerId ? null : actor.userId }, select: { id: true } })
      if (dropAddress) await tx.address.delete({ where: { id: addressId! } })

      const actorId = actor.userId
      if (oldIdentity && oldIdentity.id !== identity?.id) {
        await tx.pilgrimIdentityEvent.create({ data: { identityId: oldIdentity.id, actorId, kind: 'detached', cardId: saved.id } })
        await settleIdentity(tx, oldIdentity.id, actorId)
      }
      if (identity) {
        await settleIdentity(tx, identity.id, actorId)
        if (oldIdentity?.id !== identity.id) {
          const linked = await tx.savedPilgrim.findUnique({ where: { id: saved.id }, select: { matchStatus: true } })
          const kind = identity.created ? 'created' : linked?.matchStatus === 'conflict' ? 'conflict' : 'linked'
          await tx.pilgrimIdentityEvent.create({ data: { identityId: identity.id, actorId, kind, cardId: saved.id } })
        }
      }
      const card = await tx.savedPilgrim.findUniqueOrThrow({ where: { id: saved.id }, select: viewSelect })
      return { card, newNik: resolved.newNik }
    }, { timeout: 15_000 })
    return { ok: true, card: toView(card), warnings: await warningsFor(newNik, input) }
  } catch (e) {
    if (e instanceof Abort) return e.result
    const unique = uniqueViolation(e)
    if (unique) return unique
    throw e
  }
}

export const createSavedPilgrim = (actor: Actor, ownerId: string, input: SavedPilgrimInput) => write(actor, ownerId, null, input)
export const updateSavedPilgrim = (actor: Actor, ownerId: string, cardId: string, input: SavedPilgrimInput) => write(actor, ownerId, cardId, input)

/** Hapus-aman: kartu yang pernah dipakai booking diarsipkan (riwayat tetap utuh), selain itu dihapus sungguhan beserta alamatnya. */
export async function deleteSavedPilgrim(actor: Actor, ownerId: string, cardId: string): Promise<DeleteResult> {
  if (actor.userId !== ownerId && !isStaff(actor)) return { ok: false, status: 404, ...codedError('pilgrimNotFound') }
  const limited = await rateLimited(actor)
  if (limited) return limited
  let docKeys: string[] = []
  try {
    const out = await prisma.$transaction(async (tx) => {
      await lockOwner(tx, actor, ownerId)
      const cardSelect = { identityId: true, addressId: true, archivedAt: true, identity: { select: { nikHash: true, passportKeyHash: true } }, _count: { select: { bookingPilgrims: true } } } satisfies Prisma.SavedPilgrimSelect
      // Kunci identitas sebelum kunci baris kartu (SEC-174, sama dengan write).
      const pre = await tx.savedPilgrim.findFirst({ where: { id: cardId, ownerId }, select: cardSelect })
      if (!pre) fail(404, 'pilgrimNotFound')
      await lockIdentityKeys(tx, [pre.identity?.nikHash ?? pre.identity?.passportKeyHash])
      // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
      await tx.$queryRaw`SELECT "id" FROM "saved_pilgrims" WHERE "id" = ${cardId} AND "ownerId" = ${ownerId} FOR UPDATE`
      const card = await tx.savedPilgrim.findFirst({ where: { id: cardId, ownerId }, select: cardSelect })
      if (!card) fail(404, 'pilgrimNotFound')
      if (card.identityId !== pre.identityId) fail(409, 'pilgrimChanged')
      if (card._count.bookingPilgrims > 0) {
        if (!card.archivedAt) await tx.savedPilgrim.update({ where: { id: cardId }, data: { archivedAt: new Date() } })
        return { ok: true as const, result: 'archived' as const }
      }
      // Dokumen kartu ikut terhapus (berkas dihapus sesudah commit — baris tak pernah menunjuk objek yang sudah hilang).
      docKeys = await documentKeysOfCards(tx, [cardId])
      await deleteDocumentRowsOfCards(tx, [cardId])
      await tx.savedPilgrim.delete({ where: { id: cardId } })
      if (card.addressId) await tx.address.delete({ where: { id: card.addressId } })
      if (card.identityId) {
        await tx.pilgrimIdentityEvent.create({ data: { identityId: card.identityId, actorId: actor.userId, kind: 'detached', cardId } })
        await settleIdentity(tx, card.identityId, actor.userId)
      }
      return { ok: true as const, result: 'deleted' as const }
    })
    if (out.result === 'deleted') {
      await removeObjectsQuietly(minioDocumentStorage, docKeys, 'pilgrims/delete')
      // Unggahan yang mendarat di penyimpanan tepat saat kartu dihapus (barisnya ditolak) — sapu awalan kartu.
      await minioDocumentStorage.removePrefix(cardDocPrefix(ownerId, cardId)).catch(() => console.error('[pilgrims/delete] sapuan berkas kartu gagal'))
    }
    return out
  } catch (e) {
    if (e instanceof Abort) return e.result
    throw e
  }
}

/** Pulihkan kartu dari arsip (CRUD lengkap: yang dinonaktifkan bisa diaktifkan kembali). */
export async function restoreSavedPilgrim(actor: Actor, ownerId: string, cardId: string): Promise<WriteResult> {
  if (actor.userId !== ownerId && !isStaff(actor)) return { ok: false, status: 404, ...codedError('pilgrimNotFound') }
  const limited = await rateLimited(actor)
  if (limited) return limited
  try {
    const card = await prisma.$transaction(async (tx) => {
      await lockOwner(tx, actor, ownerId)
      const { count } = await tx.savedPilgrim.updateMany({ where: { id: cardId, ownerId }, data: { archivedAt: null } })
      if (count === 0) fail(404, 'pilgrimNotFound')
      return tx.savedPilgrim.findUniqueOrThrow({ where: { id: cardId }, select: viewSelect })
    })
    return { ok: true, card: toView(card), warnings: [] }
  } catch (e) {
    if (e instanceof Abort) return e.result
    throw e
  }
}

/** Satu kartu milik `ownerId` (pemilik sendiri atau staf) — `null` bila tak ada / milik akun lain. */
export async function getSavedPilgrim(actor: Actor, ownerId: string, cardId: string): Promise<SavedPilgrimView | null> {
  if (actor.userId !== ownerId && !isStaff(actor)) return null
  const row = await prisma.savedPilgrim.findFirst({ where: { id: cardId, ownerId }, select: viewSelect })
  return row ? toView(row) : null
}

export type ListOptions = ListParams & { q?: string; archived?: boolean }

/** Daftar kartu milik `ownerId` (pemilik sendiri atau staf), berpaginasi server; cari nama lewat kunci nama ternormalisasi. `null` = bukan haknya. */
export async function listSavedPilgrims(actor: Actor, ownerId: string, opts: ListOptions): Promise<{ items: SavedPilgrimView[]; meta: PageMeta } | null> {
  if (actor.userId !== ownerId && !isStaff(actor)) return null
  const key = opts.q?.trim() ? nameKeyOf(opts.q) : ''
  const where: Prisma.SavedPilgrimWhereInput = {
    ownerId,
    archivedAt: opts.archived ? { not: null } : null,
    ...(key ? { nameKey: { contains: escapeLike(key) } } : {}),
  }
  const { items, meta } = await paginate(
    opts,
    () => prisma.savedPilgrim.count({ where }),
    ({ skip, take }) => prisma.savedPilgrim.findMany({
      where, skip, take, select: viewSelect,
      // "Saya sendiri" selalu di atas, lalu urut nama; id = pemecah seri
      orderBy: [{ selfOfUserId: { sort: 'asc', nulls: 'last' } }, { nameKey: 'asc' }, { id: 'asc' }],
    }),
  )
  return { items: items.map(toView), meta }
}

// ─── Penghapusan akun (lib/account/deletion.ts, docs/arsitektur-jamaah.md §10) ────────────────────────────────────────────────────────

/** Identitas yang akan ikut terhapus bila akun ini dihapus: hanya dirujuk kartu dan booking akun ini sendiri. */
export function countErasableIdentities(db: Tx | typeof prisma, userId: string): Promise<number> {
  return db.pilgrimIdentity.count({
    where: {
      OR: [{ cards: { some: { ownerId: userId } } }, { bookingPilgrims: { some: { booking: { userId } } } }],
      cards: { none: { ownerId: { not: userId } } },
      NOT: { bookingPilgrims: { some: { NOT: { booking: { userId } } } } },
    },
  })
}

/**
 * Dipanggil DI DALAM transaksi penghapusan akun (baris pengguna sudah FOR UPDATE): semua kartu akun + alamatnya dihapus, tautan kartu/identitas
 * pada manifest booking akun diputus (dihitung eksplisit, tak mengandalkan SET NULL), lalu setiap identitas yang tersentuh dirapikan — tanpa
 * kartu & riwayat lain → dihapus (NIK, hash, data kanonik hilang); masih punya kartu akun lain → data kanonik diisi ulang dari kartu tersisa.
 */
export async function eraseSavedPilgrimsOf(tx: Tx, userId: string): Promise<{ savedPilgrims: number; identities: number; unlinkedManifest: number }> {
  const cards = await tx.savedPilgrim.findMany({ where: { ownerId: userId }, select: { id: true, addressId: true, identityId: true } })
  const viaBookings = await tx.bookingPilgrim.findMany({ where: { booking: { userId }, identityId: { not: null } }, select: { identityId: true } })
  const identityIds = [...new Set([...cards.map(c => c.identityId), ...viaBookings.map(b => b.identityId)].filter((x): x is string => !!x))]
  const identities = await tx.pilgrimIdentity.findMany({ where: { id: { in: identityIds } }, select: { id: true, nikHash: true, passportKeyHash: true } })
  await lockIdentityKeys(tx, identities.map(i => i.nikHash ?? i.passportKeyHash))
  // Dibaca ulang di dalam kunci: gabung/tautan petugas (F8) bisa memindahkan kartu akun ini ke identitas lain di sela itu (SEC-208).
  const moved = (await tx.savedPilgrim.findMany({ where: { ownerId: userId, identityId: { notIn: identityIds } }, select: { identityId: true } }))
    .flatMap(c => (c.identityId ? [c.identityId] : []))
  if (moved.length > 0) {
    const extra = await tx.pilgrimIdentity.findMany({ where: { id: { in: [...new Set(moved)] } }, select: { id: true, nikHash: true, passportKeyHash: true } })
    await lockIdentityKeys(tx, extra.map(i => i.nikHash ?? i.passportKeyHash))
    identities.push(...extra)
  }

  const cardIds = cards.map(c => c.id)
  const a = await tx.bookingPilgrim.updateMany({ where: { savedPilgrimId: { in: cardIds } }, data: { savedPilgrimId: null } })
  const b = await tx.bookingPilgrim.updateMany({ where: { booking: { userId }, identityId: { not: null } }, data: { identityId: null } })
  await deleteDocumentRowsOfCards(tx, cardIds) // objeknya sudah dihapus pemanggil (lib/account/deletion.ts) sebelum baris ini
  const { count } = await tx.savedPilgrim.deleteMany({ where: { ownerId: userId } })
  // Jejak identitas yang DIPERTAHANKAN (punya kartu akun lain) tak boleh lagi menautkan orang itu ke akun terhapus.
  await tx.pilgrimIdentityEvent.updateMany({ where: { actorId: userId }, data: { actorId: null } })
  if (cardIds.length > 0) await tx.pilgrimIdentityEvent.updateMany({ where: { cardId: { in: cardIds } }, data: { cardId: null } })
  const addressIds = cards.map(c => c.addressId).filter((x): x is string => !!x)
  if (addressIds.length > 0) await tx.address.deleteMany({ where: { id: { in: addressIds } } })

  let erased = 0
  for (const i of identities) if ((await settleIdentity(tx, i.id, null)) === 'deleted') erased++
  return { savedPilgrims: count, identities: erased, unlinkedManifest: a.count + b.count }
}
