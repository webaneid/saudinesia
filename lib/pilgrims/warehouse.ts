import { Prisma, type Gender, type PilgrimMatchStatus, type PilgrimReviewStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { consume, policy } from '@/lib/auth/rateLimit'
import { ensurePiiKeysMatch, maskPassport, NIK_MASK, nikIndex, normalizeNik, openNik, openPassport } from '@/lib/pii'
import { calendarDateOf, type CalendarDate } from '@/lib/time'
import { paginate, type ListParams, type PageMeta } from '@/lib/table/pagination'
import { escapeLike } from '@/lib/utils/search'
import { isRetryableConflict, retryConflict } from '@/lib/booking/serializable'
import { nameKeyOf } from './nameKey'
import { lockCardOwner, lockIdentityKeys, primaryKeyOf, settleIdentity, type Actor } from './service'

// Gudang identitas jamaah untuk STAF (docs/arsitektur-jamaah.md §4.3–§4.4, Fase 8; K4: admin, manager, superadmin). Satu-satunya penulis alias
// kunci (`pilgrim_identity_aliases`), cocok manual / lepas / pin kanonik, gabung, hapus identitas, tautan kartu tanpa kunci, dan jejak pembukaan
// NIK/paspor. Kartu dari formulir tetap ditulis lib/pilgrims/service.ts.
// Kunci: advisory lock atas KUNCI UTAMA identitas (sama dengan service.ts) SEBELUM kunci baris kartu (SEC-174). Bukan staf → 404 (tak membuka
// keberadaan fitur). Respons tak pernah membawa NIK/paspor utuh kecuali `revealIdentity` (no-store di route, berjejak).

export type WarehouseError = { ok: false; status: 400 | 404 | 409 | 422 | 429; error: string; field?: string; retryAfterSec?: number }
type Tx = Prisma.TransactionClient

class Abort extends Error {
  constructor(readonly result: WarehouseError) { super(result.error) }
}
function fail(status: WarehouseError['status'], error: string, field?: string): never {
  throw new Abort({ ok: false, status, error, ...(field ? { field } : {}) })
}
const notFound = (): WarehouseError => ({ ok: false, status: 404, error: 'Identitas jamaah tidak ditemukan' })
const isStaff = (actor: Actor) => ADMIN_ROLES.includes(actor.role)
const REVEAL_KINDS = ['nik_revealed', 'passport_revealed']
const revealCount = (tx: Tx, identityId: string) => tx.pilgrimIdentityEvent.count({ where: { identityId, kind: { in: REVEAL_KINDS } } })
const cal = (d: Date | null): CalendarDate | null => (d ? calendarDateOf(d) : null)
const sameDate = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null)

async function limited(name: 'pilgrimWriteStaff' | 'identitySearchStaff' | 'identityRevealStaff', actor: Actor): Promise<WarehouseError | null> {
  const hit = await consume(policy(name, actor.userId))
  return hit.allowed ? null : { ok: false, status: 429, error: 'Terlalu banyak permintaan. Coba lagi nanti.', retryAfterSec: hit.retryAfterSec }
}

/** Transaksi gudang: deadlock/serialisasi (gabung mengunci kartu → jamaah booking, verifikasi F6 jamaah booking → kunci identitas) diulang,
 *  lalu 409 bila tetap bentrok — tak pernah 500 (temuan audit F8, SEC-205). */
async function run<T>(fn: () => Promise<T>): Promise<T | WarehouseError> {
  try { return await retryConflict(fn) } catch (e) {
    if (e instanceof Abort) return e.result
    if (isRetryableConflict(e)) return { ok: false, status: 409, error: 'Data jamaah sedang diubah bersamaan — coba lagi' }
    throw e
  }
}

/** Kunci utama identitas (advisory) lalu baca ulang — identitas yang terhapus/tergabung di sela itu → 404. */
async function lockIdentity(tx: Tx, identityId: string) {
  const pre = await tx.pilgrimIdentity.findUnique({ where: { id: identityId }, select: { nikHash: true, passportKeyHash: true } })
  if (!pre) fail(404, 'Identitas jamaah tidak ditemukan')
  await lockIdentityKeys(tx, [primaryKeyOf(pre)])
  const now = await tx.pilgrimIdentity.findUnique({
    where: { id: identityId },
    select: { id: true, nikHash: true, nikCipher: true, passportKeyHash: true, lastVerifiedAt: true, canonicalPinnedAt: true },
  })
  if (!now || primaryKeyOf(now) !== primaryKeyOf(pre)) fail(404, 'Identitas jamaah tidak ditemukan')
  return now
}

/** Status cocok kartu DIHITUNG saat dibaca (status tersimpan bisa basi sesudah verifikasi F6 memperbarui kanonik — §8.5 butir 3). */
function liveStatus(card: { matchStatus: PilgrimMatchStatus; matchConfirmedAt: Date | null; nameKey: string; birthDate: Date | null }, canon: { nameKey: string; birthDate: Date | null }): PilgrimMatchStatus {
  if (card.matchStatus === 'unmatched') return 'unmatched'
  return card.matchConfirmedAt || (card.nameKey === canon.nameKey && sameDate(card.birthDate, canon.birthDate)) ? 'matched' : 'conflict'
}

// ── Daftar & detail ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type IdentityFilter = 'all' | 'conflict' | 'unverified'
export type IdentityRow = {
  id: string; fullName: string; birthDate: CalendarDate | null; nationality: string; hasNik: boolean
  cards: number; conflicts: number; bookings: number; verified: boolean; createdAt: string
}

/**
 * Daftar identitas berpaginasi. `q` 16 digit (spasi/titik/strip diabaikan) = cari NIK TEPAT lewat indeks HMAC (kunci utama atau alias gabungan) —
 * tak pernah LIKE atas NIK; selain itu nama lewat kunci nama (indeks trigram). Konflik dihitung dari status tersimpan (penyaring), detail menghitung ulang.
 */
export async function listIdentities(actor: Actor, opts: ListParams & { q?: string; filter?: IdentityFilter }): Promise<{ items: IdentityRow[]; meta: PageMeta } | WarehouseError> {
  if (!isStaff(actor)) return notFound()
  return run(async () => {
    const q = opts.q?.trim() ?? ''
    const where: Prisma.PilgrimIdentityWhereInput = {}
    const digits = q.replace(/[\s.\-]/g, '')
    if (/^\d{16}$/.test(digits)) {
      const stop = await limited('identitySearchStaff', actor)
      if (stop) fail(stop.status, stop.error)
      const nik = normalizeNik(digits)
      if (!nik) fail(400, 'NIK tidak valid', 'q')
      await ensurePiiKeysMatch()
      const hash = nikIndex(nik)
      where.OR = [{ nikHash: hash }, { aliases: { some: { keyHash: hash } } }]
    } else if (q) {
      where.nameKey = { contains: escapeLike(nameKeyOf(q)) }
    }
    if (opts.filter === 'conflict') where.cards = { some: { matchStatus: 'conflict' } }
    if (opts.filter === 'unverified') where.lastVerifiedAt = null
    const { items, meta } = await paginate(
      opts,
      () => prisma.pilgrimIdentity.count({ where }),
      ({ skip, take }) => prisma.pilgrimIdentity.findMany({
        where, skip, take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true, fullName: true, birthDate: true, nationality: true, nikHash: true, lastVerifiedAt: true, createdAt: true,
          _count: { select: { cards: true, bookingPilgrims: true } },
          cards: { where: { matchStatus: 'conflict' }, select: { id: true } },
        },
      }),
    )
    return {
      items: items.map(i => ({
        id: i.id, fullName: i.fullName, birthDate: cal(i.birthDate), nationality: i.nationality, hasNik: i.nikHash !== null,
        cards: i._count.cards, conflicts: i.cards.length, bookings: i._count.bookingPilgrims, verified: i.lastVerifiedAt !== null, createdAt: i.createdAt.toISOString(),
      })),
      meta,
    }
  })
}

export type IdentityDetail = {
  id: string; fullName: string; gender: Gender | null; birthPlace: string | null; birthDate: CalendarDate | null; nationality: string
  nik: string | null; keyKind: 'nik' | 'passport'; aliases: number; verifiedAt: string | null; pinnedAt: string | null; createdAt: string
  cards: {
    id: string; ownerId: string; ownerName: string | null; ownerEmail: string; fullName: string; birthDate: CalendarDate | null; gender: Gender | null
    passport: string | null; status: PilgrimMatchStatus; confirmed: boolean; nikCheckRequested: boolean; archived: boolean
  }[]
  bookings: { bookingPilgrimId: string; bookingId: string; bookingCode: string; reviewStatus: PilgrimReviewStatus }[]
  bookingsTotal: number
  events: { id: string; kind: string; actorName: string | null; cardId: string | null; detail: unknown; at: string }[]
}

export async function getIdentity(actor: Actor, identityId: string): Promise<IdentityDetail | null> {
  if (!isStaff(actor)) return null
  const i = await prisma.pilgrimIdentity.findUnique({
    where: { id: identityId },
    select: {
      id: true, fullName: true, nameKey: true, gender: true, birthPlace: true, birthDate: true, nationality: true, nikHash: true, lastVerifiedAt: true,
      canonicalPinnedAt: true, createdAt: true, _count: { select: { aliases: true, bookingPilgrims: true } },
      cards: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true, ownerId: true, fullName: true, nameKey: true, birthDate: true, gender: true, passportLast4: true, matchStatus: true,
          matchConfirmedAt: true, nikCheckRequestedAt: true, archivedAt: true, owner: { select: { fullName: true, email: true } },
        },
      },
      bookingPilgrims: {
        orderBy: [{ booking: { createdAt: 'desc' } }, { id: 'asc' }], take: 50,
        select: { id: true, reviewStatus: true, booking: { select: { id: true, bookingCode: true } } },
      },
      events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, select: { id: true, kind: true, actorId: true, cardId: true, detail: true, createdAt: true } },
    },
  })
  if (!i) return null
  const actorIds = [...new Set(i.events.map(e => e.actorId).filter((x): x is string => !!x))]
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, role: true } }))
    .map(u => [u.id, ADMIN_ROLES.includes(u.role) ? u.fullName : 'Pemilik akun']))
  return {
    id: i.id, fullName: i.fullName, gender: i.gender, birthPlace: i.birthPlace, birthDate: cal(i.birthDate), nationality: i.nationality,
    nik: i.nikHash ? NIK_MASK : null, keyKind: i.nikHash ? 'nik' : 'passport', aliases: i._count.aliases,
    verifiedAt: i.lastVerifiedAt?.toISOString() ?? null, pinnedAt: i.canonicalPinnedAt?.toISOString() ?? null, createdAt: i.createdAt.toISOString(),
    cards: i.cards.map(c => ({
      id: c.id, ownerId: c.ownerId, ownerName: c.owner.fullName, ownerEmail: c.owner.email, fullName: c.fullName, birthDate: cal(c.birthDate), gender: c.gender,
      passport: c.passportLast4 ? maskPassport(c.passportLast4) : null, status: liveStatus(c, i), confirmed: c.matchConfirmedAt !== null,
      nikCheckRequested: c.nikCheckRequestedAt !== null, archived: c.archivedAt !== null,
    })),
    bookings: i.bookingPilgrims.map(b => ({ bookingPilgrimId: b.id, bookingId: b.booking.id, bookingCode: b.booking.bookingCode, reviewStatus: b.reviewStatus })),
    bookingsTotal: i._count.bookingPilgrims,
    events: i.events.map(e => ({ id: e.id, kind: e.kind, actorName: e.actorId ? (actors.get(e.actorId) ?? null) : null, cardId: e.cardId, detail: e.detail, at: e.createdAt.toISOString() })),
  }
}

// ── Buka NIK / paspor (berjejak, K4) ────────────────────────────────────────────────────────────────────────────────────────────────────

export type RevealInput = { field: 'nik' } | { field: 'passport'; cardId: string }

/** NIK identitas atau nomor paspor kartu yang menautnya, utuh. Jejak `nik_revealed`/`passport_revealed` ditulis di transaksi yang sama. */
export async function revealIdentity(actor: Actor, identityId: string, input: RevealInput): Promise<{ ok: true; value: string } | WarehouseError> {
  if (!isStaff(actor)) return notFound()
  const stop = await limited('identityRevealStaff', actor)
  if (stop) return stop
  await ensurePiiKeysMatch()
  return run(() => prisma.$transaction(async (tx) => {
    const i = await tx.pilgrimIdentity.findUnique({ where: { id: identityId }, select: { id: true, nikHash: true, nikCipher: true } })
    if (!i) fail(404, 'Identitas jamaah tidak ditemukan')
    if (input.field === 'nik') {
      if (!i.nikHash || !i.nikCipher) fail(404, 'Identitas ini tidak memakai NIK')
      const value = openNik(i.nikCipher, i.nikHash)
      await tx.pilgrimIdentityEvent.create({ data: { identityId, actorId: actor.userId, kind: 'nik_revealed' } })
      return { ok: true as const, value }
    }
    const card = await tx.savedPilgrim.findFirst({
      where: { id: input.cardId, identityId }, select: { id: true, nationality: true, passportCipher: true, passportKeyHash: true },
    })
    if (!card?.passportCipher || !card.passportKeyHash) fail(404, 'Kartu ini tidak menyimpan nomor paspor')
    const value = openPassport(card.passportCipher, { countryCode: card.nationality, keyHash: card.passportKeyHash })
    await tx.pilgrimIdentityEvent.create({ data: { identityId, actorId: actor.userId, kind: 'passport_revealed', cardId: card.id } })
    return { ok: true as const, value }
  }))
}

// ── Kartu dalam identitas: cocok manual / lepas / jadikan kanonik ──────────────────────────────────────────────────────────────────────

export type CardAction = 'confirm' | 'detach' | 'pin'
const CARD_EVENT: Record<CardAction, string> = { confirm: 'match_confirmed', detach: 'detached', pin: 'canonical_updated' }

export async function actOnCard(actor: Actor, identityId: string, cardId: string, action: CardAction): Promise<{ ok: true; identity: 'kept' | 'deleted' } | WarehouseError> {
  if (!isStaff(actor)) return notFound()
  const stop = await limited('pilgrimWriteStaff', actor)
  if (stop) return stop
  return run(() => prisma.$transaction(async (tx) => {
    await lockIdentity(tx, identityId)
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE. Kunci identitas sudah dipegang (SEC-174).
    await tx.$queryRaw`SELECT "id" FROM "saved_pilgrims" WHERE "id" = ${cardId} AND "identityId" = ${identityId} FOR UPDATE`
    const card = await tx.savedPilgrim.findFirst({
      where: { id: cardId, identityId },
      select: { id: true, nikHash: true, passportKeyHash: true, fullName: true, nameKey: true, gender: true, birthPlace: true, birthDate: true, nationality: true, matchConfirmedAt: true },
    })
    if (!card) fail(404, 'Kartu tidak ditemukan pada identitas ini')
    const now = new Date()
    if (action === 'confirm') {
      if (card.matchConfirmedAt) fail(409, 'Kartu ini sudah ditandai cocok')
      // updatedAt kartu tidak boleh bergeser karena tindakan petugas (SEC-173: tampil ke pemilik dan membuka keberadaan data akun lain).
      await tx.$executeRaw`UPDATE "saved_pilgrims" SET "matchConfirmedAt" = ${now}, "matchConfirmedById" = ${actor.userId}, "matchStatus" = 'matched' WHERE "id" = ${cardId}`
    } else if (action === 'detach') {
      // Kartu berkunci (NIK/paspor) yang dilepas ditandai "periksa NIK": pesan generik ke pemilik + tak tertaut ulang otomatis sampai kuncinya diubah.
      const keyed = card.nikHash !== null || card.passportKeyHash !== null
      await tx.$executeRaw`UPDATE "saved_pilgrims" SET "identityId" = NULL, "matchStatus" = 'unmatched', "matchConfirmedAt" = NULL, "matchConfirmedById" = NULL,
        "nikCheckRequestedAt" = ${keyed ? now : null} WHERE "id" = ${cardId}`
    } else {
      await tx.pilgrimIdentity.update({
        where: { id: identityId },
        data: { fullName: card.fullName, nameKey: card.nameKey, gender: card.gender, birthPlace: card.birthPlace, birthDate: card.birthDate, nationality: card.nationality, canonicalPinnedAt: now },
        select: { id: true },
      })
    }
    await tx.pilgrimIdentityEvent.create({
      data: { identityId, actorId: actor.userId, kind: CARD_EVENT[action], cardId, detail: action === 'detach' ? { reason: 'staff' } : action === 'pin' ? { source: 'staff_card' } : Prisma.JsonNull },
    })
    // Melepas kartu terakhir bisa menghapus identitas beserta jejaknya (settleIdentity) — catat jejak hapus tanpa PII supaya pembukaan NIK
    // sebelumnya tetap terhitung (SEC-207).
    const reveals = action === 'detach' ? await revealCount(tx, identityId) : 0
    const settled = await settleIdentity(tx, identityId, actor.userId)
    if (settled === 'deleted') await tx.pilgrimIdentityErasure.create({ data: { actorId: actor.userId, reason: 'staff_detach', cardsDetached: 1, revealEvents: reveals } })
    return { ok: true as const, identity: settled }
  }))
}

// ── Gabung ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Gabungkan dua identitas orang yang sama: `keepId` = identitas yang DIPAKAI (dipilih petugas — data kanoniknya dipertahankan dan ditetapkan),
 * `dropId` digabung ke sana: kartu, jamaah booking, alias, dan jejaknya pindah; kunci utamanya menjadi alias `keepId`, lalu identitasnya dihapus.
 */
export async function mergeIdentities(actor: Actor, keepId: string, dropId: string): Promise<{ ok: true; identityId: string } | WarehouseError> {
  if (!isStaff(actor)) return notFound()
  if (keepId === dropId) return { ok: false, status: 400, error: 'Pilih dua identitas yang berbeda', field: 'otherId' }
  const stop = await limited('pilgrimWriteStaff', actor)
  if (stop) return stop
  return run(() => prisma.$transaction(async (tx) => {
    const pre = await tx.pilgrimIdentity.findMany({ where: { id: { in: [keepId, dropId] } }, select: { id: true, nikHash: true, passportKeyHash: true } })
    if (pre.length !== 2) fail(404, 'Identitas jamaah tidak ditemukan')
    await lockIdentityKeys(tx, pre.map(primaryKeyOf)) // terurut di lockIdentityKeys → dua gabung silang tak saling menunggu
    const keep = await tx.pilgrimIdentity.findUnique({ where: { id: keepId }, select: { id: true, nikHash: true, passportKeyHash: true, lastVerifiedAt: true } })
    const drop = await tx.pilgrimIdentity.findUnique({ where: { id: dropId }, select: { id: true, nikHash: true, passportKeyHash: true, lastVerifiedAt: true } })
    const was = new Map(pre.map(p => [p.id, primaryKeyOf(p)]))
    if (!keep || !drop || primaryKeyOf(keep) !== was.get(keepId) || primaryKeyOf(drop) !== was.get(dropId)) fail(409, 'Identitas baru saja berubah — muat ulang lalu coba lagi')

    // Kartu lewat SQL: `updatedAt` kartu tak boleh bergeser karena tindakan petugas (SEC-173).
    await tx.$executeRaw`UPDATE "saved_pilgrims" SET "identityId" = ${keepId} WHERE "identityId" = ${dropId}`
    await tx.bookingPilgrim.updateMany({ where: { identityId: dropId }, data: { identityId: keepId } })
    await tx.pilgrimIdentityAlias.updateMany({ where: { identityId: dropId }, data: { identityId: keepId } })
    await tx.pilgrimIdentityEvent.updateMany({ where: { identityId: dropId }, data: { identityId: keepId } })
    await tx.pilgrimIdentity.delete({ where: { id: dropId } })
    await tx.pilgrimIdentityAlias.create({ data: { identityId: keepId, keyHash: primaryKeyOf(drop)!, kind: drop.nikHash ? 'nik' : 'passport', createdById: actor.userId } })
    await tx.pilgrimIdentity.update({
      where: { id: keepId },
      data: { canonicalPinnedAt: new Date(), ...(keep.lastVerifiedAt === null && drop.lastVerifiedAt ? { lastVerifiedAt: drop.lastVerifiedAt } : {}) },
      select: { id: true },
    })
    await tx.pilgrimIdentityEvent.create({ data: { identityId: keepId, actorId: actor.userId, kind: 'merged', detail: { mergedIdentityId: dropId } } })
    await settleIdentity(tx, keepId, actor.userId)
    return { ok: true as const, identityId: keepId }
  }))
}

// ── Hapus identitas (hak subjek data, §10) ────────────────────────────────────────────────────────────────────────────────────────────

/** Hanya identitas yang tak pernah dipakai booking. Kartu akun dilepas (tetap milik akunnya); identitas, alias, dan jejaknya dihapus. */
export async function eraseIdentity(actor: Actor, identityId: string): Promise<{ ok: true; cardsDetached: number } | WarehouseError> {
  if (!isStaff(actor)) return notFound()
  const stop = await limited('pilgrimWriteStaff', actor)
  if (stop) return stop
  return run(() => prisma.$transaction(async (tx) => {
    await lockIdentity(tx, identityId)
    if (await tx.bookingPilgrim.count({ where: { identityId } }) > 0) {
      fail(409, 'Identitas ini pernah dipakai booking — tidak dapat dihapus sampai prosedur retensi diputuskan')
    }
    // Lewat SQL: `updatedAt` kartu tak boleh bergeser (SEC-173).
    const count = await tx.$executeRaw`UPDATE "saved_pilgrims" SET "identityId" = NULL, "matchStatus" = 'unmatched', "matchConfirmedAt" = NULL, "matchConfirmedById" = NULL
      WHERE "identityId" = ${identityId}`
    const reveals = await revealCount(tx, identityId)
    await tx.pilgrimIdentity.delete({ where: { id: identityId } })
    await tx.pilgrimIdentityErasure.create({ data: { actorId: actor.userId, reason: 'staff_erase', cardsDetached: count, revealEvents: reveals } })
    return { ok: true as const, cardsDetached: count }
  }))
}

// ── Kartu tanpa kunci (bayi tanpa NIK, §4.3) ─────────────────────────────────────────────────────────────────────────────────────────

export type UnmatchedCard = {
  id: string; fullName: string; birthDate: CalendarDate | null; ownerName: string | null; ownerEmail: string; createdAt: string
  suggestions: { id: string; fullName: string; birthDate: CalendarDate | null }[]
}

/** Kartu aktif tanpa kunci identitas dan belum tertaut, dengan saran identitas bernama ternormalisasi + tanggal lahir sama. */
export async function listUnmatchedCards(actor: Actor, opts: ListParams & { q?: string }): Promise<{ items: UnmatchedCard[]; meta: PageMeta } | null> {
  if (!isStaff(actor)) return null
  const q = opts.q?.trim() ? nameKeyOf(opts.q) : ''
  const where: Prisma.SavedPilgrimWhereInput = {
    identityId: null, nikHash: null, passportKeyHash: null, archivedAt: null, ...(q ? { nameKey: { contains: escapeLike(q) } } : {}),
  }
  const { items, meta } = await paginate(
    opts,
    () => prisma.savedPilgrim.count({ where }),
    ({ skip, take }) => prisma.savedPilgrim.findMany({
      where, skip, take, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, fullName: true, nameKey: true, birthDate: true, createdAt: true, owner: { select: { fullName: true, email: true } } },
    }),
  )
  const out: UnmatchedCard[] = []
  for (const c of items) {
    const suggestions = c.birthDate
      ? await prisma.pilgrimIdentity.findMany({ where: { nameKey: c.nameKey, birthDate: c.birthDate }, take: 5, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, fullName: true, birthDate: true } })
      : []
    out.push({
      id: c.id, fullName: c.fullName, birthDate: cal(c.birthDate), ownerName: c.owner.fullName, ownerEmail: c.owner.email, createdAt: c.createdAt.toISOString(),
      suggestions: suggestions.map(s => ({ id: s.id, fullName: s.fullName, birthDate: cal(s.birthDate) })),
    })
  }
  return { items: out, meta }
}

/** Tautkan kartu tanpa kunci ke identitas yang dipilih petugas. Kartu tetap tertaut selama tanpa kunci (service.ts); begitu NIK diisi, NIK yang menentukan. */
export async function linkUnmatchedCard(actor: Actor, cardId: string, identityId: string): Promise<{ ok: true } | WarehouseError> {
  if (!isStaff(actor)) return notFound()
  const stop = await limited('pilgrimWriteStaff', actor)
  if (stop) return stop
  return run(() => prisma.$transaction(async (tx) => {
    // Pemilik kartu dikunci dulu (FOR SHARE, akun jamaah aktif) — urutan sama dengan service.ts: pengguna → identitas → kartu; penghapusan akun
    // yang serentak menunggu atau ditunggu, tak meninggalkan tautan ke kartu yang terhapus (SEC-208).
    const owner = await tx.savedPilgrim.findUnique({ where: { id: cardId }, select: { ownerId: true } })
    if (!owner) fail(404, 'Kartu tanpa identitas tidak ditemukan')
    const refusal = await lockCardOwner(tx, actor, owner.ownerId)
    if (refusal) fail(refusal.status === 404 ? 404 : 422, refusal.status === 404 ? 'Kartu tanpa identitas tidak ditemukan' : refusal.error)
    await lockIdentity(tx, identityId)
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "saved_pilgrims" WHERE "id" = ${cardId} AND "identityId" IS NULL AND "nikHash" IS NULL AND "passportKeyHash" IS NULL AND "archivedAt" IS NULL FOR UPDATE`
    if (!rows[0]) fail(404, 'Kartu tanpa identitas tidak ditemukan')
    await tx.$executeRaw`UPDATE "saved_pilgrims" SET "identityId" = ${identityId}, "matchStatus" = 'matched' WHERE "id" = ${cardId}`
    await tx.pilgrimIdentityEvent.create({ data: { identityId, actorId: actor.userId, kind: 'linked', cardId, detail: { source: 'staff' } } })
    await settleIdentity(tx, identityId, actor.userId)
    return { ok: true as const }
  }))
}
