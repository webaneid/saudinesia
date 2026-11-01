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
import { ItemNotBookableError, itemIndexOf, remapItemIndex } from './errors'
import type { RuleViolation } from './rules'

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
  hotels: true, transports: true, muthowif: true, catering: true, tourPackages: true, flights: true, packages: true, haji: { select: { id: true } },
  pilgrims: { orderBy: { id: 'asc' }, include: { visaApplication: true, _count: { select: { documents: true } } } },
  invoice: { select: { revision: true, invoiceDate: true, dueDate: true } },
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

/** Isi item booking sekarang dalam bentuk masukan pesan (editor memuatnya; mesin membandingkannya). Harga = Σ baris berlaku item itu. */
function currentItems(b: State): CurrentItem[] {
  const lines = (type: string, id: string) => b.priceSnapshots.filter(l => l.itemType === type && l.itemId === id)
  const out: CurrentItem[] = []
  const push = (itemType: ItemType, itemId: string, item: BookingItemInput) => {
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
/** R3: jamaah boleh dihapus / visanya diganti hanya bila belum ada dokumen dan visa (bila ada) masih menunggu dokumen. */
const r3 = (p: PilgrimState) => p._count.documents === 0 && (!p.visaApplication || p.visaApplication.status === 'pending_documents')

type Plan = {
  removed: CurrentItem[]
  /** Item yang ditulis BARU, urut: ganti lalu tambah — beserta indeks masukannya (untuk harga khusus). */
  writes: Array<{ index: number; item: BookingItemInput; replaces: CurrentItem | null }>
  kept: Array<{ index: number; cur: CurrentItem }>
  pilgrimRemoves: PilgrimState[]
  /** Jamaah lama yang visa MILIKNYA berubah/dihapus (baris visa lama di-void). */
  visaRemoves: PilgrimState[]
  pilgrimWrites: BookingInput['pilgrims']
  full: BookingInput
  changes: RevisionChange[]
}

function plan(b: State, input: BookingRevisionInput): Plan {
  const cur = currentItems(b)
  const byId = new Map(cur.map(c => [c.ref.itemId, c]))
  const changes: RevisionChange[] = []
  const writes: Plan['writes'] = []
  const kept: Plan['kept'] = []
  const seen = new Set<string>()
  input.items.forEach((it, index) => {
    if (!it.ref) { writes.push({ index, item: it.item, replaces: null }); return }
    const c = byId.get(it.ref.itemId)
    if (!c || c.ref.itemType !== it.ref.itemType) throw new RevisionError(422, 'Item yang diedit tidak ditemukan pada booking ini — muat ulang halaman')
    seen.add(c.ref.itemId)
    if (canon(c.item) === canon(it.item)) kept.push({ index, cur: c })
    else writes.push({ index, item: it.item, replaces: c })
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
  let newCount = 0
  for (const sp of input.pilgrims) {
    if (!sp.pilgrimId) {
      newCount++
      pilgrimWrites.push({ visaProductId: sp.visaProductId, selectedDurationDays: sp.selectedDurationDays })
      continue
    }
    const p = pById.get(sp.pilgrimId)
    if (!p) throw new RevisionError(422, 'Jamaah yang diedit tidak ditemukan pada booking ini — muat ulang halaman')
    sentP.add(p.id)
    const own = ownVisa(b, p)
    const before = own ? canon({ v: p.visaApplication!.visaProductId, d: p.visaApplication!.selectedDurationDays ?? undefined }) : canon({})
    const after = canon({ v: sp.visaProductId, d: sp.visaProductId ? sp.selectedDurationDays : undefined })
    if (!own && p.visaApplication) {
      // Visa dari paket: diatur lewat itemnya, bukan per jamaah.
      if (sp.visaProductId && sp.visaProductId !== p.visaApplication.visaProductId) throw new RevisionError(422, `Visa Jamaah ke-${pos.get(p.id)} berasal dari paket — ubah paketnya, bukan visa jamaah`)
      continue
    }
    if (before === after) continue
    if (!r3(p)) throw new RevisionError(422, `Visa Jamaah ke-${pos.get(p.id)} sudah diproses atau dokumennya sudah diunggah — urus lewat modul Visa`)
    if (own) visaRemoves.push(p)
    if (sp.visaProductId) pilgrimWrites.push({ pilgrimId: p.id, visaProductId: sp.visaProductId, selectedDurationDays: sp.selectedDurationDays })
    changes.push({ kind: 'visa_change', label: `Jamaah ke-${pos.get(p.id)}`, detail: sp.visaProductId ? 'visa diganti' : 'visa dihapus' })
  }
  const pilgrimRemoves = b.pilgrims.filter(p => !sentP.has(p.id))
  for (const p of pilgrimRemoves) {
    if (!r3(p)) throw new RevisionError(422, `Jamaah ke-${pos.get(p.id)} tidak dapat dihapus: dokumennya sudah diunggah atau visanya sudah diproses`)
    changes.push({ kind: 'pilgrim_remove', label: `Jamaah ke-${pos.get(p.id)}` })
  }
  if (newCount > 0) changes.push({ kind: 'pilgrim_add', label: `${newCount} jamaah baru` })

  // Isi LENGKAP sesudah revisi — untuk aturan visa (D5) dan resolusi paket (slot visa paket).
  const resultingPilgrims: BookingInput['pilgrims'] = [
    ...b.pilgrims.filter(p => sentP.has(p.id)).map(p => {
      const sp = input.pilgrims.find(x => x.pilgrimId === p.id)!
      return ownVisa(b, p) || !p.visaApplication ? { visaProductId: sp.visaProductId, selectedDurationDays: sp.selectedDurationDays } : {}
    }),
    ...pilgrimWrites.filter(p => !p.pilgrimId),
  ]
  const full: BookingInput = { items: input.items.map(i => i.item), pilgrims: resultingPilgrims, totalPilgrims: resultingPilgrims.length }
  return { removed, writes, kept, pilgrimRemoves, visaRemoves, pilgrimWrites, full, changes }
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
 * Visa dari Paket Umroh (tanpa baris harga sendiri) diselaraskan dengan paket SESUDAH revisi: jumlah visa per produk = Σ orang paket yang memuat visa itu.
 * Kelebihan dihapus (hanya bila R3), kekurangan dipasangkan ke jamaah tanpa visa — urut. Visa paket yang sedang diproses tak pernah dihapus diam-diam (422).
 */
async function syncPackageVisas(tx: Tx, bookingId: string, prepared: PreparedBooking, items: BookingItemInput[], plannedTravelDate: Date | null) {
  const slots = new Map<string, number>()
  let pi = 0
  for (const it of items) {
    if (it.itemType !== 'package') continue
    const r = prepared.packages[pi++]!
    if (r.visaProductId) slots.set(r.visaProductId, (slots.get(r.visaProductId) ?? 0) + it.numPeople)
  }
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: stateInclude })
  const pkgApps = b.pilgrims.filter(p => p.visaApplication && !ownVisa(b, p))
  const keep = new Map<string, number>()
  for (const p of pkgApps) {
    const v = p.visaApplication!.visaProductId!
    const left = slots.get(v) ?? 0
    if ((keep.get(v) ?? 0) < left) { keep.set(v, (keep.get(v) ?? 0) + 1); continue }
    if (!r3(p)) throw new RevisionError(422, 'Visa dari paket sedang diproses atau dokumennya sudah diunggah — paket tak dapat dikurangi lewat edit')
    await tx.visaApplication.delete({ where: { id: p.visaApplication!.id } })
  }
  const free = b.pilgrims.filter(p => !p.visaApplication)
  for (const [v, n] of slots) {
    const missing = n - (keep.get(v) ?? 0)
    if (missing <= 0 || free.length === 0) continue // jamaah lebih sedikit dari kursi paket: sisa slot visa tak dipasangkan (sama dengan pesan baru)
    const vp = await tx.visaProduct.findUnique({ where: { id: v }, select: { visaType: true } })
    if (!vp) throw new RevisionError(422, 'Produk visa paket tidak tersedia')
    for (const p of free.splice(0, missing)) {
      await tx.visaApplication.create({ data: { bookingPilgrimId: p.id, visaProductId: v, visaType: vp.visaType, status: 'pending_documents', plannedTravelDate } })
    }
  }
}

export type RevisionResult = {
  revision: number; totalBefore: number; totalAfter: number; taxBefore: number; taxAfter: number; changes: RevisionChange[]; warnings: RuleViolation[]
  /** Pengingat uang (kelebihan bayar, bukti menunggu) — tak menolak. */ notices: string[]
  /** Harga jual tiap item SESUDAH revisi, URUT `input.items` (subtotal baris di editor). */ itemTotals: number[]
}

async function apply(tx: Tx, bookingId: string, input: BookingRevisionInput, byUserId: string, prepared: { full: PreparedBooking; writes: PreparedBooking }, planned: Plan, opts: { requireReason: boolean } = { requireReason: true }): Promise<RevisionResult> {
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
  for (const pg of p.pilgrimRemoves) await tx.bookingPilgrim.delete({ where: { id: pg.id } }) // dokumen 0 (R3); visa ikut terhapus (cascade)

  // 3. tambah / ganti (versi baru) + visa jamaah baru/ganti — mesin pesan yang sama
  const flights = [...p.kept.map(k => k.cur.item), ...p.writes.map(w => w.item)].flatMap(i => (i.itemType === 'flight' || i.itemType === 'package' ? [i.departureDate] : []))
  const plannedTravel = flights.length > 0 ? [...flights].sort()[0]! : undefined
  const written: ItemMeta[] = []
  if (p.writes.length > 0 || p.pilgrimWrites.length > 0) {
    try {
      await reserveItems(tx, prepared.writes)
      await writeBookingItems(tx, bookingId, { ...prepared.writes.data, plannedTravelDate: plannedTravel }, prepared.writes.tours, prepared.writes.packages, written)
    } catch (e) {
      remapItemIndex(e, k => p.writes[k]?.index) // nomor subset → baris editor
    }
  }
  // Produk baru SELALU ditahan `pending` (koreksi pemilik 2026-11-01) — juga pada booking yang sudah dikonfirmasi; dikonfirmasi saat pembayarannya diverifikasi.
  await syncPackageVisas(tx, bookingId, prepared.full, p.full.items, plannedTravel ? dbDateOf(plannedTravel) : null)

  // 4. harga khusus per item (R4): selisih terhadap harga item (tanpa harga khusus lamanya)
  const priceNotes: string[] = []
  const itemIdOf = new Map<number, { itemType: string; itemId: string }>()
  p.kept.forEach(k => itemIdOf.set(k.index, k.cur.ref))
  p.writes.forEach((w, i) => { const m = written[i]; if (m) itemIdOf.set(w.index, { itemType: m.itemType, itemId: m.itemId }) })
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
  if (p.changes.length === 0) throw new RevisionError(422, 'Tidak ada perubahan untuk disimpan')

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
  return { revision, totalBefore, totalAfter: sellIdr, taxBefore: inv.taxBefore, taxAfter: inv.taxAfter, changes: p.changes, warnings: prepared.full.warnings, notices, itemTotals }
}

/** Rencana + resolusi di LUAR transaksi (bacaan saja): aturan visa atas isi LENGKAP sesudah revisi, resolusi item yang akan ditulis. */
async function prepare(bookingId: string, input: BookingRevisionInput) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: stateInclude })
  if (!b) throw new RevisionError(404, 'Booking tidak ditemukan')
  if (b.status !== 'active') throw new RevisionError(409, 'Hanya booking aktif yang dapat diedit (batal/hangus/selesai tidak)')
  if (b.invoice && b.invoice.revision !== input.expectedRevision) throw new RevisionError(409, 'Booking sudah diubah orang lain sejak halaman dibuka — muat ulang lalu ulangi')
  const p = plan(b, input)
  const full = await prepareBooking(p.full, b.userId)
  // Item yang ditulis = SUBSET masukan: nomor galatnya dipetakan kembali ke baris editor.
  const toInput = (k: number) => p.writes[k]?.index
  const writes = await prepareBooking({ items: p.writes.map(w => w.item), pilgrims: p.pilgrimWrites, totalPilgrims: p.full.pilgrims.length }, b.userId, { rules: false })
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
export async function previewRevision(bookingId: string, input: BookingRevisionInput, byUserId: string): Promise<RevisionPreview> {
  const { planned, prepared } = await prepare(bookingId, input)
  try {
    await prisma.$transaction(async tx => {
      const before = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: invoiceBookingInclude })
      const grandBefore = billOf(before).grandTotal
      const r = await apply(tx, bookingId, input, byUserId, prepared, planned, { requireReason: false })
      const after = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: invoiceBookingInclude })
      const inv = await buildInvoiceData(after)
      throw new Rollback({ ...r, lines: inv.lineItems, grandBefore, grandAfter: billOf(after).grandTotal })
    }, { isolationLevel: 'Serializable' })
  } catch (e) {
    if (e instanceof Rollback) return e.result
    throw e
  }
  throw new Error('pratinjau revisi tidak di-rollback') // tak terjangkau
}

export type RevisionEditorState = {
  revision: number; invoiceDate: string; dueDate: string; confirmed: boolean; hasPayments: boolean; customerId: string
  items: CurrentItem[]
  pilgrims: Array<{ pilgrimId: string; position: number; visaProductId: string | null; selectedDurationDays: number | null; visaFromPackage: boolean; locked: boolean; lockReason: string | null }>
}

/** Isi editor revisi: item & jamaah sekarang + mana yang terkunci (R3). Data pribadi jamaah TIDAK disertakan (editor memakai urutan "Jamaah ke-N"). */
export async function revisionEditorState(bookingId: string): Promise<RevisionEditorState | null> {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: stateInclude })
  if (!b || b.status !== 'active' || !b.invoice) return null
  return {
    revision: b.invoice.revision, invoiceDate: cal(b.invoice.invoiceDate), dueDate: cal(b.invoice.dueDate), confirmed: b.confirmedAt !== null, hasPayments: b.payments.length > 0, customerId: b.userId,
    items: currentItems(b),
    pilgrims: b.pilgrims.map((p, i) => {
      const fromPackage = !!p.visaApplication && !ownVisa(b, p)
      const locked = !r3(p)
      return {
        pilgrimId: p.id, position: i + 1, visaProductId: p.visaApplication?.visaProductId ?? null, selectedDurationDays: p.visaApplication?.selectedDurationDays ?? null,
        visaFromPackage: fromPackage, locked, lockReason: locked ? (p._count.documents > 0 ? 'Dokumen sudah diunggah' : 'Visa sudah diproses') : null,
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
  if (e instanceof Error && /insufficient|capacity/.test(e.message)) return { status: 409, error: 'Kuota tidak mencukupi untuk perubahan ini' }
  if (isSerializationConflict(e)) return { status: 409, error: 'Booking sedang diproses di tempat lain — muat ulang lalu coba lagi' }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return { status: 422, error: 'Ada produk yang tidak ditemukan lagi — pilih ulang' }
  return null
}

