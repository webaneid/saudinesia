import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { BookingItemInput, BookingRevisionInput } from '@/lib/validators/booking'
import { calendarDateOf, dbDateOf } from '@/lib/time'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'
import { formatRupiah } from '@/lib/utils'
import { quotaAdapters } from '@/lib/quota/adapters'
import { CUSTOM_PRICE_PREFIX, bookingSnapshotTotals, itemSellTotals, voidItemLines, writeCustomPriceLine, type ItemMeta } from '@/lib/pricing/engine/snapshot'
import { InvoiceError, reviseInvoice } from '@/lib/invoice/issue'
import { billOf } from '@/lib/invoice/bill'
import { buildInvoiceData, invoiceBookingInclude, type InvoiceLineItem } from '@/lib/pdf/invoiceData'
import { prepareBooking, reserveItems, RuleViolationError, type BookingInput, type PreparedBooking } from './create'
import { writeBookingItems } from './lineItems'
import { recomputeBookingDates } from './dates'
import { recordRevision, type RevisionChange } from './revisionLog'
import { isSerializationConflict, retrySerializable } from './serializable'
import { ItemNotBookableError, QuotaExhaustedError, itemIndexOf, remapItemIndex } from './errors'
import { partialItemTotals } from './partialTotals'
import type { RuleViolation } from './rules'
import { BOOKING_PILGRIM_SAFE_SELECT } from '@/lib/pilgrims/safeSelect'
import { reopenForChangedRequirements } from '@/lib/pilgrims/review'
import { assignInGroups, memberProblem } from './members'
import { normalizeGroups, plannedTravelFor, targetSize } from './groups'

// Revisi booking terbit (docs/arsitektur-booking-engine-v2.md §10.4 6b, keputusan pemilik R1–R4). Masukan = isi booking LENGKAP sesudah edit; mesin menghitung selisihnya:
// item lama hilang → HAPUS (kuota dilepas sesuai status konfirmasi, baris harga di-void, baris item dihapus), item lama berubah → GANTI (hapus + tambah), item tanpa rujukan
// → TAMBAH (mesin pesan yang sama), harga khusus → baris `penyesuaian-harga:r<N>`, jamaah tambah/hapus/ganti visa (R3), tanggal invoice/jatuh tempo. Lalu pajak (tarif beku),
// revisi invoice +1, dan SATU catatan riwayat. Pratinjau = fungsi yang sama di transaksi yang selalu dibatalkan.

type Tx = Prisma.TransactionClient
type ItemType = 'hotel' | 'transport' | 'muthowif' | 'catering' | 'tourPackage' | 'flight' | 'package'

export class RevisionError extends Error {
  constructor(public readonly status: 404 | 409 | 422, message: string) { super(message); this.name = 'RevisionError' }
}

const stateInclude = {
  hotels: true, transports: true, muthowif: true, catering: true, tourPackages: true, flights: true, packages: true, haji: { select: { id: true, numPersons: true } },
  pilgrims: { orderBy: { id: 'asc' }, select: { ...BOOKING_PILGRIM_SAFE_SELECT, bookingPackageId: true, bookingHajiId: true, groupId: true, visaApplication: true } }, // tanpa kolom NIK/paspor tersegel
  invoice: { select: { revision: true, invoiceDate: true, dueDate: true } },
  groups: { orderBy: { position: 'asc' }, select: { id: true, position: true, label: true, plannedTravelDate: true } },
  payments: { where: { status: 'confirmed' }, select: { id: true } },
  priceSnapshots: { where: { voidedAt: null }, select: { itemType: true, itemId: true, lineKey: true, itemLabel: true, itemDetail: true, itemQty: true, totalSellIdr: true } },
} satisfies Prisma.BookingInclude
type State = Prisma.BookingGetPayload<{ include: typeof stateInclude }>


const cal = (d: Date) => calendarDateOf(d)
/** JSON stabil (kunci terurut, `undefined` dibuang) — dua item sama isinya ⇔ teks sama. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && x !== null).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canon(x)}`).join(',')}}`
  }
  return JSON.stringify(v)
}
const cents = (x: number) => Math.round(x * 100)

export type CurrentItem = { ref: { itemType: ItemType; itemId: string }; item: BookingItemInput; label: string; detail: string; priceIdr: number; customSellIdr: number | null }

/** Rombongan item/jamaah sebagai indeks: `undefined` = semua (tanpa rombongan), -1 = rombongan yang tak ada lagi di masukan (selalu "berubah"). */
type GroupIndexOf = (groupId: string | null) => number | undefined
/** Indeks rombongan menurut urutan tersimpan (editor). */
const storedGroupIndex = (b: State): GroupIndexOf => gid => (gid === null ? undefined : b.groups.findIndex(g => g.id === gid))

/** Isi item booking sekarang dalam bentuk masukan pesan (editor memuatnya; mesin membandingkannya). Harga = Σ baris berlaku item itu. */
function currentItems(b: State, groupOf: GroupIndexOf = storedGroupIndex(b)): CurrentItem[] {
  const lines = (type: string, id: string) => b.priceSnapshots.filter(l => l.itemType === type && l.itemId === id)
  const out: CurrentItem[] = []
  const groupIdOf = new Map<string, string | null>([...b.hotels, ...b.transports, ...b.muthowif, ...b.catering, ...b.tourPackages, ...b.flights, ...b.packages].map(r => [r.id, r.groupId]))
  const push = (itemType: ItemType, itemId: string, raw: BookingItemInput) => {
    const group = groupOf(groupIdOf.get(itemId) ?? null)
    const item = group === undefined ? raw : { ...raw, group }
    const ls = lines(itemType, itemId)
    const head = ls.find(l => !l.lineKey.startsWith(CUSTOM_PRICE_PREFIX)) ?? ls[0]
    const price = ls.reduce((s, l) => s + cents(Number(l.totalSellIdr)), 0) / 100
    out.push({ ref: { itemType, itemId }, item, label: head?.itemLabel ?? itemType, detail: head?.itemDetail ?? '', priceIdr: price, customSellIdr: ls.some(l => l.lineKey.startsWith(CUSTOM_PRICE_PREFIX)) ? price : null })
  }
  for (const r of b.hotels) push('hotel', r.id, { itemType: 'hotel', hotelRoomScheduleId: r.hotelRoomScheduleId, checkIn: cal(r.checkIn), checkOut: cal(r.checkOut), nights: r.nights, numRooms: r.numRooms })
  for (const r of b.transports) push('transport', r.id, { itemType: 'transport', transportQuotaId: r.transportQuotaId, numPassengers: r.numPassengers, pickupDetail: r.pickupDetail ?? undefined, dropoffDetail: r.dropoffDetail ?? undefined })
  for (const r of b.muthowif) push('muthowif', r.id, { itemType: 'muthowif', startDate: cal(r.startDate), endDate: cal(r.endDate), numDays: r.numDays, numPeople: r.numPeople })
  for (const r of b.catering) push('catering', r.id, { itemType: 'catering', cateringOptionId: r.cateringOptionId, startDate: cal(r.startDate), endDate: cal(r.endDate), numDays: r.numDays, numPeople: r.numPeople })
  for (const r of b.tourPackages) push('tourPackage', r.id, {
    itemType: 'tourPackage', tourPackageId: r.tourPackageId, tourDate: cal(r.tourDate), numPeople: r.numPeople, transportQuotaId: r.transportQuotaId ?? undefined,
    chosenHotelRoomScheduleId: r.chosenHotelRoomScheduleId ?? undefined, chosenHotelNumRooms: r.chosenHotelNumRooms ?? undefined,
  })
  for (const r of b.flights) push('flight', r.id, { itemType: 'flight', flightScheduleId: r.flightScheduleId, departureDate: cal(r.departureDate), numPassengers: r.numPassengers })
  for (const r of b.packages) push('package', r.id, { itemType: 'package', packageId: r.packageId, departureDate: cal(r.departureDate), numPeople: r.numPeople, choices: (r.choices ?? {}) as Extract<BookingItemInput, { itemType: 'package' }>['choices'] })
  return out
}

type PilgrimState = State['pilgrims'][number]
/** Visa MILIK jamaah (berbaris harga sendiri) — bukan visa dari paket (tanpa baris harga). */
const ownVisa = (b: State, p: PilgrimState) => !!p.visaApplication && b.priceSnapshots.some(l => l.itemType === 'visa' && l.itemId === p.visaApplication!.id)
/** R3: jamaah boleh dihapus / visanya diganti hanya bila belum memakai data jamaah tersimpan (dokumen kartu/perjalanan menempel lewat kartu, Fase 7a)
 *  dan visa (bila ada) masih menunggu dokumen. */
const r3 = (p: PilgrimState) => p.savedPilgrimId === null && (!p.visaApplication || p.visaApplication.status === 'pending_documents')

type Plan = {
  removed: CurrentItem[]
  /** Item yang ditulis BARU, urut: ganti lalu tambah — beserta indeks masukannya (untuk harga khusus). */
  writes: Array<{ index: number; item: BookingItemInput; replaces: CurrentItem | null }>
  kept: Array<{ index: number; cur: CurrentItem }>
  pilgrimRemoves: PilgrimState[]
  /** Jamaah lama yang visa MILIKNYA berubah/dihapus (baris visa lama di-void). */
  visaRemoves: PilgrimState[]
  pilgrimWrites: BookingInput['pilgrims']
  /** Asal harga visa tiap jamaah masukan (urut `input.pilgrims`). */
  visaSources: Array<{ write: number } | { appId: string } | null>
  full: BookingInput
  changes: RevisionChange[]
  /** Jamaah lama yang rombongannya berubah (indeks ke `input.groups`; `undefined` = tanpa rombongan). */
  groupMoves: Array<{ pilgrimId: string; group: number | undefined }>
}

function plan(b: State, input: BookingRevisionInput): Plan {
  // Rombongan (§10.8): rombongan lama dikenali dari `id`; yang tak dikirim → -1 (item/jamaahnya pasti berubah). Id rombongan booking lain → 422.
  const inputGroups = input.groups ?? []
  const groupIndex = new Map(inputGroups.flatMap((g, i) => (g.id ? [[g.id, i] as const] : [])))
  for (const id of groupIndex.keys()) if (!b.groups.some(g => g.id === id)) throw new RevisionError(422, 'Rombongan yang diedit tidak ditemukan pada booking ini — muat ulang halaman')
  const groupOf: GroupIndexOf = gid => (gid === null ? undefined : groupIndex.get(gid) ?? -1)
  const groups = inputGroups.map(({ id: _id, ...g }) => g) // eslint-disable-line @typescript-eslint/no-unused-vars
  // Jumlah orang item DITURUNKAN dari ukuran sasaran sesudah revisi — memindah jamaah mengubah item rombongan asal dan tujuannya (lalu item itu ditulis ulang).
  const items = normalizeGroups({ items: input.items.map(i => i.item), pilgrims: input.pilgrims.map(p => ({ group: p.group })), groups }).items

  const cur = currentItems(b, groupOf)
  const byId = new Map(cur.map(c => [c.ref.itemId, c]))
  const changes: RevisionChange[] = []
  const writes: Plan['writes'] = []
  const kept: Plan['kept'] = []
  const seen = new Set<string>()
  input.items.forEach((it, index) => {
    const item = items[index]!
    if (!it.ref) { writes.push({ index, item, replaces: null }); return }
    const c = byId.get(it.ref.itemId)
    if (!c || c.ref.itemType !== it.ref.itemType) throw new RevisionError(422, 'Item yang diedit tidak ditemukan pada booking ini — muat ulang halaman')
    seen.add(c.ref.itemId)
    if (canon(c.item) === canon(item)) kept.push({ index, cur: c })
    else writes.push({ index, item, replaces: c })
  })
  const removed = cur.filter(c => !seen.has(c.ref.itemId))
  for (const c of removed) changes.push({ kind: 'remove', label: c.label, detail: c.detail })
  for (const w of writes) if (w.replaces) changes.push({ kind: 'replace', label: w.replaces.label, detail: w.replaces.detail })

  // Jamaah (R3)
  const pos = new Map(b.pilgrims.map((p, i) => [p.id, i + 1]))
  const pById = new Map(b.pilgrims.map(p => [p.id, p]))
  const sentP = new Set<string>()
  const pilgrimWrites: BookingInput['pilgrims'] = []
  const visaRemoves: PilgrimState[] = []
  // Asal harga visa tiap jamaah masukan (urut `input.pilgrims`): nomor urut visa yang DITULIS revisi ini, id pengajuan visa lama yang dipertahankan, atau tanpa visa sendiri.
  const visaSources: Array<{ write: number } | { appId: string } | null> = []
  let visaWrites = 0
  let newCount = 0
  const groupMoves: Plan['groupMoves'] = []
  for (const sp of input.pilgrims) {
    if (!sp.pilgrimId) {
      newCount++
      pilgrimWrites.push({ visaProductId: sp.visaProductId, selectedDurationDays: sp.selectedDurationDays, group: sp.group })
      visaSources.push(sp.visaProductId ? { write: visaWrites++ } : null)
      continue
    }
    const p = pById.get(sp.pilgrimId)
    if (!p) throw new RevisionError(422, 'Jamaah yang diedit tidak ditemukan pada booking ini — muat ulang halaman')
    sentP.add(p.id)
    if (groupOf(p.groupId) !== sp.group) {
      groupMoves.push({ pilgrimId: p.id, group: sp.group })
      // Hanya posisi ("Rombongan ke-M") yang dicatat — nama rombongan teks bebas pemesan, bisa memuat nama orang (K11d-4).
      if (b.groups.length > 0 && inputGroups.length > 0) changes.push({ kind: 'group_move', label: `Jamaah ke-${pos.get(p.id)}`, detail: sp.group === undefined ? 'keluar dari rombongan' : `ke Rombongan ke-${sp.group + 1}` })
    }
    const own = ownVisa(b, p)
    const before = own ? canon({ v: p.visaApplication!.visaProductId, d: p.visaApplication!.selectedDurationDays ?? undefined }) : canon({})
    const after = canon({ v: sp.visaProductId, d: sp.visaProductId ? sp.selectedDurationDays : undefined })
    if (!own && p.visaApplication) {
      // Visa dari paket: diatur lewat itemnya, bukan per jamaah.
      if (sp.visaProductId && sp.visaProductId !== p.visaApplication.visaProductId) throw new RevisionError(422, `Visa Jamaah ke-${pos.get(p.id)} berasal dari paket — ubah paketnya, bukan visa jamaah`)
      visaSources.push(null)
      continue
    }
    if (before === after) { visaSources.push(own ? { appId: p.visaApplication!.id } : null); continue }
    if (!r3(p)) throw new RevisionError(422, `Visa Jamaah ke-${pos.get(p.id)} sudah diproses atau jamaahnya sudah memakai data jamaah tersimpan — urus lewat modul Visa`)
    if (own) visaRemoves.push(p)
    if (sp.visaProductId) pilgrimWrites.push({ pilgrimId: p.id, visaProductId: sp.visaProductId, selectedDurationDays: sp.selectedDurationDays, group: sp.group })
    visaSources.push(sp.visaProductId ? { write: visaWrites++ } : null)
    changes.push({ kind: 'visa_change', label: `Jamaah ke-${pos.get(p.id)}`, detail: sp.visaProductId ? 'visa diganti' : 'visa dihapus' })
  }
  const pilgrimRemoves = b.pilgrims.filter(p => !sentP.has(p.id))
  for (const p of pilgrimRemoves) {
    if (!r3(p)) throw new RevisionError(422, `Jamaah ke-${pos.get(p.id)} tidak dapat dihapus: sudah memakai data jamaah tersimpan (lepas tautannya dulu) atau visanya sudah diproses`)
    changes.push({ kind: 'pilgrim_remove', label: `Jamaah ke-${pos.get(p.id)}` })
  }
  if (newCount > 0) changes.push({ kind: 'pilgrim_add', label: `${newCount} jamaah baru` })

  // Rombongan ditambah / dihapus / diubah (nama atau rencana berangkat) — ringkas, tanpa nama.
  const added = inputGroups.filter(g => !g.id).length
  const dropped = b.groups.filter(g => !groupIndex.has(g.id)).length
  const edited = inputGroups.some((g, i) => {
    const old = g.id ? b.groups.find(x => x.id === g.id) : undefined
    return !!old && ((old.label ?? undefined) !== g.label || (old.plannedTravelDate ? cal(old.plannedTravelDate) : undefined) !== g.plannedTravelDate || old.position !== i + 1)
  })
  if (added || dropped || edited) {
    const parts = [added && `${added} ditambah`, dropped && `${dropped} dihapus`, edited && 'nama/urutan/rencana berangkat diubah'].filter(Boolean)
    changes.push({ kind: 'groups', label: 'Rombongan', detail: inputGroups.length === 0 ? 'rombongan ditiadakan' : parts.join(', ') })
  }

  // Isi LENGKAP sesudah revisi — untuk aturan visa (D5, per rombongan) dan resolusi paket (slot visa paket).
  const resultingPilgrims: BookingInput['pilgrims'] = [
    ...b.pilgrims.filter(p => sentP.has(p.id)).map(p => {
      const sp = input.pilgrims.find(x => x.pilgrimId === p.id)!
      return { ...(ownVisa(b, p) || !p.visaApplication ? { visaProductId: sp.visaProductId, selectedDurationDays: sp.selectedDurationDays } : {}), group: sp.group }
    }),
    ...pilgrimWrites.filter(p => !p.pilgrimId),
  ]
  const full: BookingInput = { items, pilgrims: resultingPilgrims, totalPilgrims: resultingPilgrims.length, ...(groups.length > 0 && { groups }) }
  return { removed, writes, kept, pilgrimRemoves, visaRemoves, pilgrimWrites, visaSources, full, changes, groupMoves }
}

const itemDelegate = (tx: Tx, t: ItemType) => ({
  hotel: tx.bookingHotel, transport: tx.bookingTransport, muthowif: tx.bookingMuthowif, catering: tx.bookingCatering,
  tourPackage: tx.bookingTourPackage, flight: tx.bookingFlight, package: tx.bookingPackage,
} as const)[t]

/** Lepas kuota satu baris item sesuai STATUS BARIS ITU (`quotaConfirmed`: `booked` vs `pending`). */
async function releaseRow(tx: Tx, b: State, c: CurrentItem) {
  const id = c.ref.itemId
  const rel = <T extends { id: string; quotaConfirmed: boolean }>(rows: T[], fn: (tx: Tx, row: T, o: { confirmed: boolean }) => Promise<void>) => {
    const row = rows.find(r => r.id === id)!
    return fn(tx, row, { confirmed: row.quotaConfirmed })
  }
  switch (c.ref.itemType) {
    case 'hotel': return rel(b.hotels, quotaAdapters.hotel.release)
    case 'transport': return rel(b.transports, quotaAdapters.transport.release)
    case 'muthowif': return rel(b.muthowif, quotaAdapters.muthowif.release)
    case 'catering': return
    case 'tourPackage': return rel(b.tourPackages, quotaAdapters.tourPackage.release)
    case 'flight': return rel(b.flights, quotaAdapters.flight.release)
    case 'package': return rel(b.packages, quotaAdapters.package.release)
  }
}

/**
 * Anggota Paket Umroh + visa paketnya diselaraskan dengan item SESUDAH revisi lewat aturan tunggal `assignMembers` (lib/booking/members.ts): anggota lama
 * dipertahankan, kursi kosong diisi urut, jamaah yang keluar paket kehilangan visa paketnya (hanya bila R3 — visa paket yang sedang diproses tak pernah
 * dihapus diam-diam, 422), anggota baru paket bervisa mendapat pengajuan visa dan verifikasinya dibuka ulang (SEC-201). Booking ber-Haji tak dapat direvisi.
 */
async function syncMembers(
  tx: Tx, bookingId: string, rows: Array<{ key: string; numPeople: number; visaProductId: string | null; name: string; group?: number }>,
  groupIds: readonly string[], plannedTravelOf: (group: number | undefined) => Date | null, byUserId: string,
) {
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: stateInclude })
  const groupOf = (gid: string | null) => (gid === null ? undefined : groupIds.indexOf(gid))
  const pilgrims = b.pilgrims.map(p => {
    const own = ownVisa(b, p)
    return { key: p.id, ownVisa: own, packageVisa: !own ? p.visaApplication?.visaProductId ?? null : null, currentPackage: p.bookingPackageId, currentHaji: p.bookingHajiId, group: groupOf(p.groupId) }
  })
  // Per rombongan bila berrombongan — aturan tunggal yang sama dengan pesan baru (lib/booking/members.ts `assignInGroups`).
  const r = assignInGroups(rows, b.haji.map(h => ({ key: h.id, numPeople: h.numPersons })), pilgrims, groupIds.length)
  if (!r.ok) throw new RevisionError(422, memberProblem(r, k => rows.find(x => x.key === k)?.name ?? 'paket').message)
  const visaOf = new Map(rows.map(x => [x.key, x.visaProductId]))
  for (const [i, pg] of b.pilgrims.entries()) {
    const m = r.members[i]!
    if (m.package !== pg.bookingPackageId || m.haji !== pg.bookingHajiId) {
      await tx.bookingPilgrim.update({ where: { id: pg.id }, data: { bookingPackageId: m.package, bookingHajiId: m.haji }, select: { id: true } })
    }
    if (pilgrims[i]!.ownVisa) continue // visa milik sendiri diatur lewat jamaah (plan), bukan paket
    const had = pilgrims[i]!.packageVisa
    const want = (m.package && visaOf.get(m.package)) || null
    if (had === want) continue
    if (had) {
      if (!r3(pg)) throw new RevisionError(422, 'Visa dari paket sedang diproses atau jamaahnya sudah memakai data jamaah tersimpan — paket tak dapat dikurangi lewat edit')
      await tx.visaApplication.delete({ where: { id: pg.visaApplication!.id } })
    }
    if (want) {
      const vp = await tx.visaProduct.findUnique({ where: { id: want }, select: { visaType: true } })
      if (!vp) throw new RevisionError(422, 'Produk visa paket tidak tersedia')
      await tx.visaApplication.create({ data: { bookingPilgrimId: pg.id, visaProductId: want, visaType: vp.visaType, status: 'pending_documents', plannedTravelDate: plannedTravelOf(pilgrims[i]!.group) } })
      // Syarat dokumen visa baru belum tercakup verifikasi lama (SEC-201).
      await reopenForChangedRequirements(tx, pg.id, byUserId, 'Visa ditambahkan lewat revisi booking — dokumen visa perlu diperiksa')
    }
  }
}

/**
 * Baris rombongan sesudah revisi, urut `input.groups` (posisi 1..n). Posisi unik per booking → baris lama dipindah ke posisi sementara dulu supaya urut ulang
 * tak bertabrakan. Rombongan lama yang tak dikirim TIDAK dihapus di sini (pemanggil menghapusnya sesudah jamaahnya dipindah).
 */
async function syncGroups(tx: Tx, b: State, input: BookingRevisionInput): Promise<string[]> {
  const wanted = input.groups ?? []
  const shift = b.groups.length + wanted.length + 1
  for (const g of b.groups) await tx.bookingGroup.update({ where: { id: g.id }, data: { position: g.position + shift }, select: { id: true } })
  const ids: string[] = []
  for (const [i, g] of wanted.entries()) {
    const data = { position: i + 1, label: g.label ?? null, plannedTravelDate: g.plannedTravelDate ? dbDateOf(g.plannedTravelDate) : null }
    const row = g.id
      ? await tx.bookingGroup.update({ where: { id: g.id, bookingId: b.id }, data, select: { id: true } })
      : await tx.bookingGroup.create({ data: { bookingId: b.id, ...data }, select: { id: true } })
    ids.push(row.id)
  }
  return ids
}

export type RevisionResult = {
  revision: number; totalBefore: number; totalAfter: number; taxBefore: number; taxAfter: number; changes: RevisionChange[]
  /** Pengingat uang (kelebihan bayar, bukti menunggu) — tak menolak. */ notices: string[]
  /** Harga jual tiap item SESUDAH revisi, URUT `input.items` (subtotal baris di editor). */ itemTotals: number[]
  /** Harga jual visa milik tiap jamaah SESUDAH revisi, URUT `input.pilgrims` (0 = tanpa visa sendiri; visa paket ada di baris paketnya). */ pilgrimVisaTotals: number[]
}

async function apply(tx: Tx, bookingId: string, input: BookingRevisionInput, byUserId: string, prepared: { full: PreparedBooking; writes: PreparedBooking }, planned: Plan, opts: { requireReason: boolean; allowNoChange?: boolean } = { requireReason: true }): Promise<RevisionResult> {
  // $queryRaw: Prisma ORM tak punya SELECT … FOR UPDATE — revisi, atur total, konfirmasi bayar, dan batal pada booking yang sama diserialkan.
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`)
  if (locked.length === 0) throw new RevisionError(404, 'Booking tidak ditemukan')
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: stateInclude })
  if (b.status !== 'active') throw new RevisionError(409, 'Hanya booking aktif yang dapat diedit (batal/hangus/selesai tidak)')
  if (!b.invoice) throw new RevisionError(409, 'Booking ini belum punya invoice')
  if (b.invoice.revision !== input.expectedRevision) throw new RevisionError(409, 'Booking sudah diubah orang lain sejak halaman dibuka — muat ulang lalu ulangi')
  if (b.haji.length > 0) throw new RevisionError(409, 'Booking berisi Haji belum dapat diedit lewat form admin')
  // Rencana dihitung ULANG atas keadaan terkunci; revisi sama ⇒ item sama, tetapi status visa/dokumen/konfirmasi bisa berubah tanpa revisi.
  const p = plan(b, input)
  if (canon(p.writes.map(w => w.item)) !== canon(planned.writes.map(w => w.item))) throw new RevisionError(409, 'Booking berubah saat disimpan — muat ulang lalu ulangi')

  const confirmed = b.confirmedAt !== null
  const reason = input.reason?.trim() || null
  // Pratinjau tak menuntut alasan (editor menampilkan total sambil mengetik); SIMPAN tetap menuntutnya (R2).
  if (opts.requireReason && (confirmed || b.payments.length > 0) && (reason?.length ?? 0) < 3) {
    throw new RevisionError(422, 'Booking sudah dikonfirmasi atau sudah ada pembayaran — isi alasan revisi (minimal 3 karakter)')
  }
  const revision = b.invoice.revision + 1
  const totalBefore = Number(b.totalAmount)
  // I4 sebelum mengubah apa pun: penyimpangan lama dilaporkan, bukan "disembuhkan" diam-diam oleh penjumlahan ulang (pola lib/booking/adjustments.ts).
  if (cents((await bookingSnapshotTotals(tx, bookingId)).sellIdr) !== cents(totalBefore)) throw new RevisionError(409, 'Total pesanan tidak sama dengan jumlah rincian harga — hubungi pengembang sebelum merevisi')
  const voidReason = `revisi ke-${revision}`

  // 1. hapus / ganti: lepas kuota, void baris harga, hapus baris item
  for (const c of [...p.removed, ...p.writes.flatMap(w => (w.replaces ? [w.replaces] : []))]) {
    await releaseRow(tx, b, c)
    await voidItemLines(tx, { bookingId, itemType: c.ref.itemType, itemId: c.ref.itemId, byUserId, reason: voidReason, revision })
    await (itemDelegate(tx, c.ref.itemType) as unknown as { delete: (a: { where: { id: string } }) => Promise<unknown> }).delete({ where: { id: c.ref.itemId } })
  }
  // 2. jamaah dihapus / visa milik diganti-dihapus
  for (const pg of [...p.pilgrimRemoves, ...p.visaRemoves]) {
    if (pg.visaApplication && ownVisa(b, pg)) await voidItemLines(tx, { bookingId, itemType: 'visa', itemId: pg.visaApplication.id, byUserId, reason: voidReason, revision })
  }
  for (const pg of p.visaRemoves) await tx.visaApplication.delete({ where: { id: pg.visaApplication!.id } })
  for (const pg of p.pilgrimRemoves) {
    // R3 diperiksa ulang di baris itu sendiri: tautan kartu (lib/pilgrims/bookingLink.ts mengunci baris jamaah, bukan booking) bisa masuk sesudah
    // keadaan dibaca — jamaah bertaut tak pernah terhapus diam-diam. Visa ikut terhapus (cascade).
    const gone = await tx.bookingPilgrim.deleteMany({ where: { id: pg.id, savedPilgrimId: null } })
    if (gone.count !== 1) throw new RevisionError(409, 'Data jamaah berubah saat menyimpan (baru ditautkan ke data jamaah tersimpan) — muat ulang lalu coba lagi')
  }

  // 2b. rombongan (§10.8): baris lama diperbarui/diurutkan ulang, yang baru dibuat, jamaah dipindah, lalu rombongan yang tak dikirim dihapus (item & jamaahnya
  // sudah dihapus/diganti di langkah 1–2 — FK komposit NO ACTION menolak bila masih dirujuk).
  const groupIds = await syncGroups(tx, b, input)
  for (const m of p.groupMoves) {
    await tx.bookingPilgrim.update({ where: { id: m.pilgrimId }, data: { groupId: m.group === undefined ? null : groupIds[m.group]! }, select: { id: true } })
  }
  await tx.bookingGroup.deleteMany({ where: { bookingId, id: { notIn: groupIds } } })

  // 3. tambah / ganti (versi baru) + visa jamaah baru/ganti — mesin pesan yang sama
  const flightOf = (i: BookingItemInput) => (i.itemType === 'flight' || i.itemType === 'package' ? [{ date: i.departureDate, group: i.group }] : [])
  const keptFlights = p.kept.flatMap(k => flightOf(p.full.items[k.index]!))
  const allFlights = [...keptFlights, ...p.writes.flatMap(w => flightOf(w.item))]
  const grouped = groupIds.length > 0
  // Tanpa rombongan: tiket paling awal di booking (perilaku lama). Berrombongan: per rombongan (tiketnya ∪ tiket semua, lalu rencana rombongan) — tiket rombongan lain tak dipakai.
  const plannedTravel = grouped ? undefined : plannedTravelFor(allFlights, undefined, undefined, undefined)
  const plannedTravelOf = (group: number | undefined) => { const d = plannedTravelFor(allFlights, group, p.full.groups, plannedTravel); return d ? dbDateOf(d) : null }
  const written: ItemMeta[] = []
  if (p.writes.length > 0 || p.pilgrimWrites.length > 0) {
    try {
      await reserveItems(tx, prepared.writes)
      await writeBookingItems(tx, bookingId, { ...prepared.writes.data, plannedTravelDate: plannedTravel }, prepared.writes.tours, prepared.writes.packages, written,
        { assignMembers: false, groupIds, knownFlights: keptFlights })
    } catch (e) {
      remapItemIndex(e, k => p.writes[k]?.index) // nomor subset → baris editor
    }
  }
  // Produk baru SELALU ditahan `pending` (koreksi pemilik 2026-11-01) — juga pada booking yang sudah dikonfirmasi; dikonfirmasi saat pembayarannya diverifikasi.
  const itemIdOf = new Map<number, { itemType: string; itemId: string }>()
  p.kept.forEach(k => itemIdOf.set(k.index, k.cur.ref))
  p.writes.forEach((w, i) => { const m = written[i]; if (m) itemIdOf.set(w.index, { itemType: m.itemType, itemId: m.itemId }) })
  // Baris paket SESUDAH revisi, urut masukan; visa paket = hasil resolusi (included atau pilihan) dari isi lengkap.
  let pkgIdx = 0
  const packageRows = input.items.flatMap((it, index) => {
    if (it.item.itemType !== 'package') return []
    const r = prepared.full.packages[pkgIdx++]!
    const id = itemIdOf.get(index)?.itemId
    const item = p.full.items[index]! as Extract<BookingItemInput, { itemType: 'package' }>
    return id ? [{ key: id, numPeople: item.numPeople, visaProductId: r.visaProductId, name: r.name, group: item.group }] : []
  })
  await syncMembers(tx, bookingId, packageRows, groupIds, plannedTravelOf, byUserId)
  // Tamu hotel yang dipertahankan = ukuran sasaran sesudah revisi (jumlah kamar & kuota tak berubah — hanya catatan tamunya).
  for (const k of p.kept) {
    if (k.cur.ref.itemType !== 'hotel') continue
    const guests = targetSize(p.full, p.full.items[k.index]!.group)
    if (b.hotels.find(h => h.id === k.cur.ref.itemId)?.numGuests !== guests) await tx.bookingHotel.update({ where: { id: k.cur.ref.itemId }, data: { numGuests: guests }, select: { id: true } })
  }

  // 4. harga khusus per item (R4): selisih terhadap harga item (tanpa harga khusus lamanya)
  const priceNotes: string[] = []
  for (const [index, ref] of itemIdOf) {
    const want = input.items[index]!.customSellIdr ?? null
    const kept = p.kept.find(k => k.index === index)
    if (!kept && want === null) continue // item baru/ganti tanpa harga khusus
    if (kept && (kept.cur.customSellIdr === null ? want === null || cents(want) === cents(kept.cur.priceIdr) : want !== null && cents(want) === cents(kept.cur.customSellIdr))) continue
    // Catatan wajib hanya saat harga khusus DITETAPKAN/DIUBAH (yang tak berubah dilewati di atas) — editor tak perlu mengetik ulang catatan lama.
    if (want !== null && (input.items[index]!.priceNote?.length ?? 0) < 3) throw new RevisionError(422, 'Harga khusus wajib disertai catatan (minimal 3 karakter)')
    await voidItemLines(tx, { bookingId, itemType: ref.itemType, itemId: ref.itemId, byUserId, reason: voidReason, revision, lineKeyPrefix: CUSTOM_PRICE_PREFIX })
    const lines = await tx.priceSnapshot.findMany({ where: { bookingId, itemType: ref.itemType, itemId: ref.itemId, voidedAt: null }, select: { totalSellIdr: true, itemLabel: true, itemDetail: true, itemQty: true } })
    const base = lines.reduce((s, l) => s + cents(Number(l.totalSellIdr)), 0) / 100
    const head = lines[0]
    if (want !== null && head) {
      await writeCustomPriceLine(tx, { bookingId, itemType: ref.itemType, itemId: ref.itemId, revision, amountIdr: want - base, itemLabel: head.itemLabel, itemDetail: head.itemDetail, itemQty: head.itemQty })
      priceNotes.push(`Harga khusus ${head.itemLabel}: ${input.items[index]!.priceNote ?? ''}`)
    }
    p.changes.push({ kind: 'price', label: head?.itemLabel ?? 'Item', detail: want === null ? 'harga khusus dihapus' : 'harga khusus' })
  }
  for (const w of p.writes) if (!w.replaces) p.changes.push({ kind: 'add', label: written[p.writes.indexOf(w)]?.label ?? w.item.itemType, detail: written[p.writes.indexOf(w)]?.detail })

  // 5. tanggal invoice / jatuh tempo
  if (input.invoiceDate !== calendarDateOf(b.invoice.invoiceDate) || input.dueDate !== calendarDateOf(b.invoice.dueDate)) {
    p.changes.push({ kind: 'dates', label: 'Tanggal invoice / jatuh tempo', detail: `${input.invoiceDate} → jatuh tempo ${input.dueDate}` })
  }
  if (p.changes.length === 0 && !opts.allowNoChange) throw new RevisionError(422, 'Tidak ada perubahan untuk disimpan')

  // 6. total (I4: Σ baris berlaku), tanggal acuan, invoice (pajak beku, revisi +1), riwayat
  const { sellIdr } = await bookingSnapshotTotals(tx, bookingId)
  if (!(sellIdr > 0)) throw new RevisionError(422, 'Total sesudah revisi harus lebih dari 0 — batalkan booking bila memang tak berbayar')
  if (sellIdr > MAX_PRICE_IDR && sellIdr > totalBefore) throw new RevisionError(422, 'Total sesudah revisi melebihi batas wajar — periksa kembali harga/jumlahnya')
  await tx.booking.update({ where: { id: bookingId }, data: { totalAmount: sellIdr } })
  await recomputeBookingDates(tx, bookingId)
  const inv = await reviseInvoice(tx, bookingId, { invoiceDate: input.invoiceDate, dueDate: input.dueDate })
  if (inv.revision !== revision) throw new Error('nomor revisi invoice tidak berurutan') // tak terjangkau: booking terkunci
  const fullReason = [reason, ...priceNotes].filter(Boolean).join('\n') || null
  await recordRevision(tx, { bookingId, revision, kind: 'items', reason: fullReason, summary: p.changes, totalBefore, totalAfter: sellIdr, taxBefore: inv.taxBefore, taxAfter: inv.taxAfter, byUserId })
  // Uang yang sudah masuk / menunggu verifikasi TIDAK diubah revisi (prinsip 3) — admin diingatkan; refund & ledger = Fase 7.
  const pays = await tx.payment.findMany({ where: { bookingId, status: { in: ['confirmed', 'pending'] } }, select: { status: true, amount: true } })
  const paid = pays.filter(x => x.status === 'confirmed').reduce((sum, x) => sum + cents(Number(x.amount)), 0) / 100
  const grandAfter = (cents(sellIdr) + cents(inv.taxAfter)) / 100
  const notices: string[] = []
  if (paid > grandAfter) notices.push(`Sudah dibayar ${formatRupiah(paid)} — melebihi tagihan baru ${formatRupiah(grandAfter)} (kelebihan bayar; refund dicatat terpisah).`)
  if (pays.some(x => x.status === 'pending')) notices.push('Ada bukti transfer yang menunggu verifikasi — jumlahnya mungkin tak lagi sama dengan tagihan baru.')
  const sells = await itemSellTotals(tx, bookingId)
  const itemTotals = input.items.map((_, i) => { const r = itemIdOf.get(i); return r ? sells.get(`${r.itemType}:${r.itemId}`) ?? 0 : 0 })
  // Visa yang ditulis revisi ini menyusul item yang ditulis, urut `pilgrimWrites` (lib/booking/lineItems.ts); visa lama yang dipertahankan dibaca dari pengajuannya.
  const visaMetas = written.slice(p.writes.length)
  const pilgrimVisaTotals = p.visaSources.map(src => {
    if (!src) return 0
    const id = 'write' in src ? visaMetas[src.write]?.itemId : src.appId
    return id ? sells.get(`visa:${id}`) ?? 0 : 0
  })
  return { revision, totalBefore, totalAfter: sellIdr, taxBefore: inv.taxBefore, taxAfter: inv.taxAfter, changes: p.changes, notices, itemTotals, pilgrimVisaTotals }
}

/** Rencana + resolusi di LUAR transaksi (bacaan saja): aturan visa atas isi LENGKAP sesudah revisi, resolusi item yang akan ditulis. */
async function prepare(bookingId: string, input: BookingRevisionInput) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: stateInclude })
  if (!b) throw new RevisionError(404, 'Booking tidak ditemukan')
  if (b.status !== 'active') throw new RevisionError(409, 'Hanya booking aktif yang dapat diedit (batal/hangus/selesai tidak)')
  if (b.invoice && b.invoice.revision !== input.expectedRevision) throw new RevisionError(409, 'Booking sudah diubah orang lain sejak halaman dibuka — muat ulang lalu ulangi')
  const p = plan(b, input)
  const full = await prepareBooking(p.full)
  // Item yang ditulis = SUBSET masukan (sudah dinormalisasi atas isi lengkap): nomor galatnya dipetakan kembali ke baris editor.
  const toInput = (k: number) => p.writes[k]?.index
  const sizes = p.full.groups ? (p.full.groups.map((_, g) => p.full.pilgrims.filter(x => x.group === g).length)) : undefined
  const writes = await prepareBooking({ items: p.writes.map(w => w.item), pilgrims: p.pilgrimWrites, totalPilgrims: p.full.pilgrims.length, groups: p.full.groups, groupSizes: sizes }, { rules: false, normalize: false })
    .catch(e => remapItemIndex(e, toInput))
  return { planned: p, prepared: { full, writes } }
}

export async function reviseBooking(bookingId: string, input: BookingRevisionInput, byUserId: string): Promise<RevisionResult> {
  const { planned, prepared } = await prepare(bookingId, input)
  return retrySerializable(() => prisma.$transaction(tx => apply(tx, bookingId, input, byUserId, prepared, planned), { isolationLevel: 'Serializable' }))
}

export type RevisionPreview = RevisionResult & { lines: InvoiceLineItem[]; grandBefore: number; grandAfter: number }
class Rollback extends Error { constructor(public readonly result: RevisionPreview) { super('rollback') } }

/** Akibat revisi TANPA menyimpan: angka, baris invoice, perubahan, pelanggaran, galat kuota identik dengan simpan; seluruh tulisan dibatalkan. */
export async function previewRevision(bookingId: string, input: BookingRevisionInput, byUserId: string, opts: { allowNoChange?: boolean } = {}): Promise<RevisionPreview> {
  const { planned, prepared } = await prepare(bookingId, input)
  try {
    await prisma.$transaction(async tx => {
      const before = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: invoiceBookingInclude })
      const grandBefore = billOf(before).grandTotal
      const r = await apply(tx, bookingId, input, byUserId, prepared, planned, { requireReason: false, allowNoChange: opts.allowNoChange })
      const after = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: invoiceBookingInclude })
      const inv = await buildInvoiceData(after, tx)
      throw new Rollback({ ...r, lines: inv.lineItems, grandBefore, grandAfter: billOf(after).grandTotal })
    }, { isolationLevel: 'Serializable' })
  } catch (e) {
    if (e instanceof Rollback) return e.result
    throw e
  }
  throw new Error('pratinjau revisi tidak di-rollback') // tak terjangkau
}

/** Pratinjau revisi gagal karena satu baris (`itemIndex`): subtotal baris lain dihitung tanpa baris itu (tampilan editor saja). */
export async function revisionPartialTotals(bookingId: string, input: BookingRevisionInput, byUserId: string, failedIndex: number): Promise<(number | null)[]> {
  return partialItemTotals(input.items.length, failedIndex, async keep =>
    (await previewRevision(bookingId, { ...input, items: keep.map(i => input.items[i]!) }, byUserId, { allowNoChange: true })).itemTotals) // tanpa baris gagal bisa sama dengan isi sekarang
}

export type RevisionEditorState = {
  revision: number; invoiceDate: string; dueDate: string; confirmed: boolean; hasPayments: boolean; customerId: string
  items: CurrentItem[]
  pilgrims: Array<{ pilgrimId: string; position: number; group?: number; visaProductId: string | null; selectedDurationDays: number | null; visaFromPackage: boolean; locked: boolean; lockReason: string | null; visaPriceIdr: number }>
  /** Rombongan urut posisi (indeks = `group` item/jamaah); kosong = tanpa rombongan. */
  groups: Array<{ id: string; label: string | null; plannedTravelDate: string | null }>
}

/** Isi editor revisi: item & jamaah sekarang + mana yang terkunci (R3). Data pribadi jamaah TIDAK disertakan (editor memakai urutan "Jamaah ke-N"). */
export async function revisionEditorState(bookingId: string): Promise<RevisionEditorState | null> {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: stateInclude })
  if (!b || b.status !== 'active' || !b.invoice) return null
  return {
    revision: b.invoice.revision, invoiceDate: cal(b.invoice.invoiceDate), dueDate: cal(b.invoice.dueDate), confirmed: b.confirmedAt !== null, hasPayments: b.payments.length > 0, customerId: b.userId,
    items: currentItems(b),
    groups: b.groups.map(g => ({ id: g.id, label: g.label, plannedTravelDate: g.plannedTravelDate ? cal(g.plannedTravelDate) : null })),
    pilgrims: b.pilgrims.map((p, i) => {
      const fromPackage = !!p.visaApplication && !ownVisa(b, p)
      const locked = !r3(p)
      // Harga jual visa sendiri (baris snapshot berlaku) — subtotal baris Visa di editor sebelum ada pratinjau; visa paket ada di baris paketnya.
      const visaPriceIdr = p.visaApplication && !fromPackage
        ? b.priceSnapshots.filter(l => l.itemType === 'visa' && l.itemId === p.visaApplication!.id).reduce((sum, l) => sum + cents(Number(l.totalSellIdr)), 0) / 100 : 0
      return {
        pilgrimId: p.id, position: i + 1, ...(p.groupId !== null && { group: b.groups.findIndex(g => g.id === p.groupId) }), visaProductId: p.visaApplication?.visaProductId ?? null, selectedDurationDays: p.visaApplication?.selectedDurationDays ?? null,
        visaFromPackage: fromPackage, locked, lockReason: locked ? (p.savedPilgrimId !== null ? 'Sudah memakai data jamaah tersimpan' : 'Visa sudah diproses') : null, visaPriceIdr,
      }
    }),
  }
}

/** Galat revisi → respons (status + pesan + pelanggaran aturan). `null` = galat tak terduga (route menjawab 500 + log). */
export function revisionFailure(e: unknown): { status: number; error: string; violations?: RuleViolation[]; itemIndex?: number } | null {
  const r = revisionFailureOf(e)
  const itemIndex = itemIndexOf(e) // baris editor (urut `input.items`) penyebab galat
  return r && itemIndex !== undefined ? { ...r, itemIndex } : r
}

function revisionFailureOf(e: unknown): { status: number; error: string; violations?: RuleViolation[] } | null {
  if (e instanceof RevisionError) return { status: e.status, error: e.message }
  if (e instanceof RuleViolationError) return { status: 422, error: e.message, violations: e.violations }
  if (e instanceof ItemNotBookableError || e instanceof InvoiceError) return { status: 422, error: e.message }
  if (e instanceof QuotaExhaustedError) return { status: 409, error: 'Kuota tidak mencukupi untuk perubahan ini' }
  if (isSerializationConflict(e)) return { status: 409, error: 'Booking sedang diproses di tempat lain — muat ulang lalu coba lagi' }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return { status: 422, error: 'Ada produk yang tidak ditemukan lagi — pilih ulang' }
  return null
}

