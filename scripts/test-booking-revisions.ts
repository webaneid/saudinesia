// Uji revisi booking terbit (docs/arsitektur-booking-engine-v2.md §10.4 6b, keputusan R1–R4): tambah/hapus/ganti item dengan kuota tepat (pending vs booked), harga khusus,
// jamaah (R3), aturan visa atas isi sesudah revisi, revisi basi 409, catatan wajib R2, pratinjau = simpan tanpa sisa, pajak beku, invarian I4 atas baris berlaku, riwayat,
// atur total dilonggarkan, pembatalan booking terkonfirmasi melepas `booked` (bug lama 6b.3), dan penjaga sumber (pembaca snapshot menyaring void, satu penulis riwayat).
// PENGAMAN: menulis ke database — hanya DB sekali pakai (assertThrowawayDb). Setelan yang diubah dikembalikan.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { bookingSnapshotTotals } from '@/lib/pricing/engine/snapshot'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { createDraft, publishDraft, saveDraft } from '@/lib/booking/drafts'
import { previewRevision, reviseBooking, revisionEditorState, RevisionError } from '@/lib/booking/revise'
import { RuleViolationError } from '@/lib/booking/create'
import { setBookingTotal, AdjustmentError } from '@/lib/booking/adjustments'
import { cancelBooking } from '@/lib/booking/cancel'
import { processPayment } from '@/lib/payments/process'
import { billOf } from '@/lib/invoice/bill'
import { buildInvoiceData, invoiceBookingInclude } from '@/lib/pdf/invoiceData'
import { bookingRevisionSchema, type BookingDraft, type BookingRevisionInput } from '@/lib/validators/booking'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const tag = `rev${Date.now()}`
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]
const num = (v: unknown) => Number(v)

// ── dunia uji ────────────────────────────────────────────────────────────────────────────────────────────────────────
const savedRules = await prisma.pricingRule.findMany()
const savedTax = await prisma.taxRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })
await prisma.taxRule.updateMany({ data: { isActive: false } })
const ppn = await prisma.taxRule.create({ data: { name: `${tag} PPN`, ratePercent: 11, basisPercent: 100, mode: 'added', isActive: true } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
async function addCost(productType: string, productId: string, component: string, cost: number) {
  await prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent: component, currency: 'IDR', costTiers: flat(cost) as never } })
  await prisma.preferredVendor.create({ data: { productType, productId, costComponent: component, vendorId: vendor.id } })
}
const customer = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Pelanggan Revisi', role: 'pilgrim', isActive: true } })
const staff = await prisma.user.create({ data: { email: `${tag}-staf@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true } })
const route = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: 'JED' } })
const flight = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 200 } })
await addCost('flight', flight.id, 'tiket', 5_000_000); await repriceOwner('flight', flight.id) // jual 6.000.000
const roomType = await prisma.roomType.create({ data: { name: `${tag} quad`, defaultCapacity: 4 } })
const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel`, city: 'makkah' } })
const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
const room = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, totalQuota: 50 } })
await addCost('hotel', room.id, 'kamar', 1_000_000); await repriceOwner('hotel', room.id) // jual 1.200.000 / kamar-malam
const trip = await prisma.transportTrip.create({ data: { name: `${tag} bandara`, category: 'airport', origin: 'JED', destination: 'Makkah' } })
const van = await prisma.transportVehicle.create({ data: { name: `${tag} van`, vehicleType: 'van', capacity: 10 } })
const pricing = await prisma.transportPricing.create({ data: { tripId: trip.id, vehicleId: van.id } })
await addCost('transport', pricing.id, 'sewa', 800_000); await repriceOwner('transport', pricing.id) // jual 1.000.000
const tq = await prisma.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date('2090-06-11'), totalSeats: 100 } })
const visa = await prisma.visaProduct.create({ data: { name: `${tag} Visa`, visaType: 'Umroh', requiredComponents: [{ type: 'flight' }] } })
await addCost('visa', visa.id, 'visa', 1_000_000); await repriceOwner('visa', visa.id) // jual 1.200.000

const FL = (n: number) => ({ itemType: 'flight' as const, flightScheduleId: flight.id, departureDate: '2090-06-10', numPassengers: n })
const HT = (rooms: number) => ({ itemType: 'hotel' as const, hotelRoomScheduleId: room.id, checkIn: '2090-06-10', checkOut: '2090-06-13', nights: 3, numRooms: rooms })
const TR = { itemType: 'transport' as const, transportQuotaId: tq.id, numPassengers: 2 }
async function published(d: BookingDraft) {
  const c = await createDraft(customer.id); assert.ok(c.ok)
  assert.ok((await saveDraft(c.id, d)).ok)
  const r = await publishDraft(c.id, { byUserId: staff.id }); assert.ok(r.ok, JSON.stringify(r))
  return c.id
}
/** Masukan revisi = isi booking sekarang apa adanya (editor memuat ini), lalu diubah tiap kasus. */
async function base(id: string): Promise<BookingRevisionInput> {
  const s = await revisionEditorState(id); assert.ok(s)
  return {
    expectedRevision: s.revision, invoiceDate: s.invoiceDate, dueDate: s.dueDate,
    items: s.items.map(i => ({ ref: i.ref, item: i.item, customSellIdr: i.customSellIdr })),
    pilgrims: s.pilgrims.map(p => (p.visaFromPackage ? { pilgrimId: p.pilgrimId } : { pilgrimId: p.pilgrimId, visaProductId: p.visaProductId ?? undefined, selectedDurationDays: p.selectedDurationDays ?? undefined })),
  }
}
const seats = () => prisma.flightSchedule.findUniqueOrThrow({ where: { id: flight.id }, select: { pendingSeats: true, bookedSeats: true } })
const rooms = () => prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id: room.id }, select: { pendingQuota: true, bookedQuota: true } })
const vseats = () => prisma.transportQuota.findUniqueOrThrow({ where: { id: tq.id }, select: { pendingSeats: true, bookedSeats: true } })
const full = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id }, include: invoiceBookingInclude })
async function i4(id: string) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { totalAmount: true } })
  assert.equal(num(b.totalAmount), (await bookingSnapshotTotals(prisma, id)).sellIdr, 'I4: total = Σ baris berlaku')
}
const DRAFT: BookingDraft = { items: [FL(2)], pilgrims: [{ visaProductId: visa.id }, { visaProductId: visa.id }], dueDays: 3 }

await t('TANPA PERUBAHAN → 422; skema: harga khusus tanpa catatan / rujukan ganda / jatuh tempo sebelum tanggal invoice DITOLAK', async () => {
  const id = await published(DRAFT)
  await assert.rejects(async () => reviseBooking(id, await base(id), staff.id), (e: unknown) => e instanceof RevisionError && e.status === 422)
  const b = await base(id)
  assert.equal(bookingRevisionSchema.safeParse({ ...b, items: [{ ...b.items[0]!, customSellIdr: 1 }] }).success, false)
  assert.equal(bookingRevisionSchema.safeParse({ ...b, items: [b.items[0]!, b.items[0]!] }).success, false)
  assert.equal(bookingRevisionSchema.safeParse({ ...b, dueDate: '2000-01-01' }).success, false)
  assert.equal(bookingRevisionSchema.safeParse({ ...b, total: 1 }).success, false, '.strict()')
})

await t('TAMBAH hotel: kuota pending +2 kamar, total & pajak beku dihitung ulang, revisi invoice 2, riwayat tercatat; PRATINJAU sama persis dan tanpa sisa', async () => {
  const id = await published(DRAFT) // 12.000.000 + 2 visa 2.400.000 = 14.400.000
  const r0 = await rooms()
  const input = await base(id)
  input.items.push({ item: HT(2) }) // 3 malam × 2 kamar × 1.200.000 = 7.200.000
  const pv = await previewRevision(id, input, staff.id)
  assert.deepEqual([pv.totalBefore, pv.totalAfter, pv.taxAfter, pv.revision, pv.grandAfter], [14_400_000, 21_600_000, 2_376_000, 2, 23_976_000])
  assert.deepEqual(await rooms(), r0, 'pratinjau tak menahan kuota')
  assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { bookingId: id } })).revision, 1, 'pratinjau tak menaikkan revisi')
  const r = await reviseBooking(id, input, staff.id)
  assert.deepEqual([r.totalAfter, r.taxAfter, r.revision], [pv.totalAfter, pv.taxAfter, pv.revision])
  assert.deepEqual(await rooms(), { pendingQuota: r0.pendingQuota + 2, bookedQuota: r0.bookedQuota })
  const b = await full(id)
  assert.equal(billOf(b).grandTotal, 23_976_000)
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { bookingId: id } })
  assert.deepEqual([inv.revision, num(inv.taxAddedIdr)], [2, 2_376_000])
  const log = await prisma.bookingRevision.findMany({ where: { bookingId: id } })
  assert.equal(log.length, 1)
  assert.deepEqual([log[0]!.revision, log[0]!.kind, num(log[0]!.totalAfter), (log[0]!.summary as Array<{ kind: string }>)[0]!.kind], [2, 'items', 21_600_000, 'add'])
  await i4(id)
})

await t('GANTI tiket 2 → 3 penumpang: baris lama DI-VOID (jejak tetap, revisi 2), baris item baru; kursi pending −2 +3; invoice hanya baris berlaku; I4', async () => {
  const id = await published(DRAFT)
  const s0 = await seats()
  const oldRow = await prisma.bookingFlight.findFirstOrThrow({ where: { bookingId: id } })
  const input = await base(id)
  input.items[0] = { ...input.items[0]!, item: FL(3) }
  await reviseBooking(id, input, staff.id)
  assert.deepEqual(await seats(), { pendingSeats: s0.pendingSeats + 1, bookedSeats: s0.bookedSeats })
  assert.equal(await prisma.bookingFlight.count({ where: { id: oldRow.id } }), 0, 'baris item lama dihapus')
  const voided = await prisma.priceSnapshot.findMany({ where: { bookingId: id, itemId: oldRow.id } })
  assert.ok(voided.length > 0 && voided.every(v => v.voidedAt && v.voidRevision === 2 && v.voidedById === staff.id), JSON.stringify(voided.map(v => v.voidRevision)))
  const inv = await buildInvoiceData(await full(id))
  assert.deepEqual(inv.lineItems.filter(l => l.label.startsWith('Tiket')).map(l => [l.qty, l.amount]), [[3, 18_000_000]])
  await i4(id)
})

await t('HARGA KHUSUS (R4): item tiket 10.000.000 → baris penyesuaian item (modal asli tetap), invoice menampilkan 10.000.000; dihapus lagi → baris di-void, harga kembali; catatan ada di riwayat', async () => {
  const id = await published(DRAFT)
  const input = await base(id)
  input.items[0] = { ...input.items[0]!, customSellIdr: 10_000_000, priceNote: 'nego rombongan' }
  await reviseBooking(id, input, staff.id)
  let inv = await buildInvoiceData(await full(id))
  assert.equal(inv.lineItems.find(l => l.label.startsWith('Tiket'))!.amount, 10_000_000)
  const custom = await prisma.priceSnapshot.findFirstOrThrow({ where: { bookingId: id, lineKey: { startsWith: 'penyesuaian-harga:' } } })
  assert.deepEqual([num(custom.totalSellIdr), custom.totalCostIdr, custom.mode], [-2_000_000, null, 'manual'])
  assert.match((await prisma.bookingRevision.findFirstOrThrow({ where: { bookingId: id } })).reason ?? '', /nego rombongan/)
  const again = await base(id)
  assert.equal(again.items[0]!.customSellIdr, 10_000_000, 'editor memuat harga khusus')
  again.items[0] = { ...again.items[0]!, customSellIdr: null }
  await reviseBooking(id, again, staff.id)
  inv = await buildInvoiceData(await full(id))
  assert.equal(inv.lineItems.find(l => l.label.startsWith('Tiket'))!.amount, 12_000_000)
  assert.ok((await prisma.priceSnapshot.findUniqueOrThrow({ where: { id: custom.id } })).voidedAt)
  await i4(id)
})

await t('JAMAAH (R3): tambah jamaah + visa → baris visa baru; hapus jamaah BER-DOKUMEN → 422; hapus jamaah tanpa dokumen → visa di-void; ganti visa yang sudah diproses → 422', async () => {
  const id = await published(DRAFT)
  const input = await base(id)
  input.pilgrims.push({ visaProductId: visa.id })
  await reviseBooking(id, input, staff.id)
  assert.equal(await prisma.bookingPilgrim.count({ where: { bookingId: id } }), 3)
  const ps = await prisma.bookingPilgrim.findMany({ where: { bookingId: id }, orderBy: { id: 'asc' }, include: { visaApplication: true } })
  await prisma.document.create({ data: { bookingPilgrimId: ps[0]!.id, docType: 'passport', fileName: 'p.pdf', filePath: `pilgrims/${ps[0]!.id}/passport/x.pdf` } })
  const rm1 = await base(id); rm1.pilgrims = rm1.pilgrims.filter(p => p.pilgrimId !== ps[0]!.id)
  await assert.rejects(() => reviseBooking(id, rm1, staff.id), (e: unknown) => e instanceof RevisionError && e.status === 422 && /dokumen/.test(e.message))
  const rm2 = await base(id); rm2.pilgrims = rm2.pilgrims.filter(p => p.pilgrimId !== ps[1]!.id)
  await reviseBooking(id, rm2, staff.id)
  assert.equal(await prisma.bookingPilgrim.count({ where: { id: ps[1]!.id } }), 0)
  assert.ok((await prisma.priceSnapshot.findFirstOrThrow({ where: { itemType: 'visa', itemId: ps[1]!.visaApplication!.id } })).voidedAt)
  await prisma.visaApplication.update({ where: { id: ps[2]!.visaApplication!.id }, data: { status: 'submitted_to_syarikah' } })
  const ch = await base(id); ch.pilgrims = ch.pilgrims.map(p => (p.pilgrimId === ps[2]!.id ? { pilgrimId: p.pilgrimId } : p))
  await assert.rejects(() => reviseBooking(id, ch, staff.id), (e: unknown) => e instanceof RevisionError && e.status === 422 && /diproses/.test(e.message))
  await i4(id)
})

await t('ATURAN VISA atas isi SESUDAH revisi: menghapus tiket padahal visa mewajibkan tiket → 422 berisi pelanggaran, tak ada yang berubah', async () => {
  const id = await published(DRAFT)
  const s0 = await seats()
  const input = await base(id); input.items = []
  await assert.rejects(() => reviseBooking(id, input, staff.id), (e: unknown) => e instanceof RuleViolationError && e.violations[0]?.missing === 'flight')
  assert.deepEqual(await seats(), s0)
})

await t('BASI: expectedRevision lama → 409; booking BATAL → 409', async () => {
  const id = await published(DRAFT)
  const stale = await base(id)
  const fresh = await base(id); fresh.items.push({ item: HT(1) })
  await reviseBooking(id, fresh, staff.id)
  stale.items.push({ item: TR })
  await assert.rejects(() => reviseBooking(id, stale, staff.id), (e: unknown) => e instanceof RevisionError && e.status === 409)
  const id2 = await published(DRAFT)
  await prisma.booking.update({ where: { id: id2 }, data: { status: 'cancelled' } })
  const x = { ...stale, expectedRevision: 1 }
  await assert.rejects(() => reviseBooking(id2, x, staff.id), (e: unknown) => e instanceof RevisionError && e.status === 409)
})

await t('TERKONFIRMASI (R2): tanpa alasan → 422; dengan alasan: hapus hotel melepas BOOKED (bukan pending), tambah transport langsung BOOKED', async () => {
  const id = await published({ ...DRAFT, items: [FL(2), HT(1)] })
  const pay = await prisma.payment.create({ data: { bookingId: id, amount: 0, method: 'transfer', status: 'pending' } })
  assert.equal((await processPayment(pay.id, { action: 'confirm', byUserId: staff.id })).kind, 'done')
  const r0 = await rooms(); const v0 = await vseats()
  const input = await base(id)
  input.items = input.items.filter(i => i.item.itemType !== 'hotel')
  input.items.push({ item: TR })
  await assert.rejects(() => reviseBooking(id, input, staff.id), (e: unknown) => e instanceof RevisionError && e.status === 422 && /alasan/.test(e.message))
  await reviseBooking(id, { ...input, reason: 'jamaah batal menginap' }, staff.id)
  assert.deepEqual(await rooms(), { pendingQuota: r0.pendingQuota, bookedQuota: r0.bookedQuota - 1 })
  assert.deepEqual(await vseats(), { pendingSeats: v0.pendingSeats, bookedSeats: v0.bookedSeats + 2 })
  await i4(id)
})

await t('BATAL booking TERKONFIRMASI melepas kursi BOOKED (bug lama: pending dikurangi → minus, kursi tak kembali)', async () => {
  const id = await published(DRAFT)
  const pay = await prisma.payment.create({ data: { bookingId: id, amount: 0, method: 'transfer', status: 'pending' } })
  await processPayment(pay.id, { action: 'confirm', byUserId: staff.id })
  const s0 = await seats()
  await prisma.$transaction(async tx => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id }, include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true } })
    await cancelBooking(tx, b, 'uji')
  })
  assert.deepEqual(await seats(), { pendingSeats: s0.pendingSeats, bookedSeats: s0.bookedSeats - 2 })
})

await t('ATUR TOTAL dilonggarkan (R2): booking terkonfirmasi tanpa catatan → 422; dengan catatan → revisi invoice +1, riwayat jenis total, pajak beku ikut', async () => {
  const id = await published(DRAFT)
  const pay = await prisma.payment.create({ data: { bookingId: id, amount: 0, method: 'transfer', status: 'pending' } })
  await processPayment(pay.id, { action: 'confirm', byUserId: staff.id })
  await assert.rejects(() => setBookingTotal({ bookingId: id, totalIdr: 10_000_000, byUserId: staff.id }), (e: unknown) => e instanceof AdjustmentError && e.status === 422)
  await setBookingTotal({ bookingId: id, totalIdr: 10_000_000, reason: 'nego setelah konfirmasi', byUserId: staff.id })
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { bookingId: id } })
  assert.deepEqual([inv.revision, num(inv.taxAddedIdr)], [2, 1_100_000])
  const log = await prisma.bookingRevision.findFirstOrThrow({ where: { bookingId: id } })
  assert.deepEqual([log.kind, log.revision, log.reason], ['total', 2, 'nego setelah konfirmasi'])
  await i4(id)
})

await t('PASCA-AUDIT: kelebihan bayar & bukti menunggu → PENGINGAT (tak menolak); total di atas batas wajar → 422; harga khusus / tanggal di luar rentang ditolak skema; total ≠ Σ baris sebelum revisi → 409', async () => {
  const id = await published({ ...DRAFT, items: [FL(2), HT(1)] })
  const b0 = await full(id)
  const pay = await prisma.payment.create({ data: { bookingId: id, amount: 0, method: 'transfer', status: 'pending' } })
  await processPayment(pay.id, { action: 'confirm', byUserId: staff.id }) // lunas = tagihan penuh
  await prisma.payment.create({ data: { bookingId: id, amount: 1000, method: 'transfer', status: 'pending' } })
  const input = await base(id); input.items = input.items.filter(i => i.item.itemType !== 'hotel'); input.reason = 'hotel batal'
  const r = await reviseBooking(id, input, staff.id)
  assert.ok(r.notices.some(n => /kelebihan bayar/.test(n)) && r.notices.some(n => /menunggu verifikasi/.test(n)), JSON.stringify(r.notices))
  assert.ok(billOf(b0).grandTotal > 0)
  const b = await base(id)
  assert.equal(bookingRevisionSchema.safeParse({ ...b, items: [{ ...b.items[0]!, customSellIdr: 6_000_000_000, priceNote: 'uji' }] }).success, false)
  assert.equal(bookingRevisionSchema.safeParse({ ...b, invoiceDate: '2090-01-01', dueDate: '2090-01-02' }).success, false)
  assert.equal(bookingRevisionSchema.safeParse({ ...b, dueDate: '2099-01-01' }).success, false)
  const big = await base(id); big.reason = 'uji'; big.items[0] = { ...big.items[0]!, customSellIdr: 5_000_000_000, priceNote: 'uji batas' }
  big.items.push({ item: HT(1), customSellIdr: 5_000_000_000, priceNote: 'uji batas' })
  await assert.rejects(() => reviseBooking(id, big, staff.id), (e: unknown) => e instanceof RevisionError && e.status === 422 && /batas wajar/.test(e.message))
  await prisma.booking.update({ where: { id }, data: { totalAmount: 1 } })
  const drift = await base(id); drift.reason = 'uji'; drift.items.push({ item: TR })
  await assert.rejects(() => reviseBooking(id, drift, staff.id), (e: unknown) => e instanceof RevisionError && e.status === 409 && /rincian harga/.test(e.message))
})
await t('PASCA-AUDIT (Medium): unggah dokumen menulis baris di bawah kunci FOR SHARE booking dan MEMBUANG berkas bila jamaah sudah dihapus revisi (tak ada objek yatim)', () => {
  const up = read('app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/route.ts')
  const post = up.slice(up.indexOf('export async function POST'))
  assert.match(post, /FOR SHARE/)
  assert.ok(post.indexOf('FOR SHARE') < post.indexOf('tx.document.create'), 'kunci sebelum menulis baris')
  assert.match(post, /if \(!doc\) \{\s*await deleteObject\(objectKey\)/)
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap(f => {
    const rel = join(dir, f)
    return statSync(join(root, rel)).isDirectory() ? files(rel) : /\.(ts|tsx)$/.test(f) ? [rel] : []
  })
}
const SRC = [...files('app'), ...files('lib')]
await t('PENJAGA: setiap pembacaan price_snapshots menyaring baris void (`voidedAt`) atau beralasan `void-ok`; satu penulis riwayat revisi; deletion membersihkan catatan revisi', () => {
  const bad: string[] = []
  for (const f of SRC) {
    read(f).split('\n').forEach((line, i) => {
      if (/priceSnapshot\.(findMany|findFirst|findUnique|aggregate|count|groupBy)\(|FROM "price_snapshots"|priceSnapshots:\s*\{/.test(line)) {
        const ctx = read(f).split('\n').slice(i, i + 4).join('\n')
        if (!/voidedAt|void-ok/.test(ctx)) bad.push(`${f}:${i + 1}`)
      }
    })
  }
  assert.deepEqual(bad, [])
  const writers = SRC.filter(f => /bookingRevision\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(read(f)))
  assert.deepEqual(writers.sort(), ['lib/account/deletion.ts', 'lib/booking/revisionLog.ts'])
  assert.match(read('lib/account/deletion.ts'), /bookingRevision\.updateMany\(\{ where: \{ booking: \{ userId \}, reason: \{ not: null \} \}, data: \{ reason: '\[dihapus\]' \} \}\)/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.document.deleteMany({ where: { pilgrim: { booking: { userId: customer.id } } } })
await prisma.payment.deleteMany({ where: { booking: { userId: customer.id } } })
await prisma.refund.deleteMany({ where: { booking: { userId: customer.id } } })
await prisma.booking.deleteMany({ where: { userId: customer.id } })
await prisma.visaProduct.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.transportQuota.deleteMany({ where: { pricingId: pricing.id } })
await prisma.transportPricing.delete({ where: { id: pricing.id } })
await prisma.transportTrip.delete({ where: { id: trip.id } })
await prisma.transportVehicle.delete({ where: { id: van.id } })
await prisma.flightSchedule.deleteMany({ where: { routeId: route.id } })
await prisma.flightRoute.delete({ where: { id: route.id } })
await prisma.hotel.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.roomType.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.user.deleteMany({ where: { id: { in: [customer.id, staff.id] } } })
await prisma.taxRule.delete({ where: { id: ppn.id } })
for (const r of savedTax) await prisma.taxRule.update({ where: { id: r.id }, data: { isActive: r.isActive } })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
