// Fase 7 harga terpadu (docs/arsitektur-harga-terpadu.md §20, 7A+7B): penyesuaian total pesanan (diskon/biaya tambahan) dan jumlah pembayaran terkonfirmasi, terhadap DATABASE SUNGGUHAN.
// Dibuktikan: total = Σ snapshot tetap (satu baris `penyesuaian` per perubahan, tanpa UPDATE snapshot), catatan WAJIB bila total akhir < HPP awal (kode DAN CHECK DB), hanya saat menunggu
// pembayaran, total akhir > 0, pembatalan lewat baris pembalik (sekali), perubahan paralel terkunci, label tampil di invoice tetapi catatan INTERNAL tak pernah bocor, laba laporan ikut berkurang,
// serta aturan jumlah pembayaran dan penjaga sumber.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { AdjustmentError, adjustBookingTotal, listAdjustments, reverseAdjustment } from '@/lib/booking/adjustments'
import { buildInvoiceData, invoiceBookingInclude } from '@/lib/pdf/invoiceData'
import { getProfitReport } from '@/lib/reports/profit'
import { PaymentAmountError, resolveConfirmedAmount } from '@/lib/payments/confirmAmount'
import { processPayment } from '@/lib/payments/process'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `adj${Date.now()}`
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Penyesuaian', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const staff = await prisma.user.create({ data: { email: `${tag}-staff@example.test`, passwordHash: 'x', fullName: 'Admin Uji', role: 'admin', isActive: true, emailVerifiedAt: new Date() } })
const bookings: string[] = []
let n = 0

/** Booking menunggu pembayaran: hotel jual 1.000.000 (modal 800.000) + visa jual 500.000 (modal 400.000) → total 1.500.000, HPP awal diketahui 1.200.000. */
async function mkBooking(status: 'awaiting_payment' | 'payment_review' | 'confirmed' | 'cancelled' = 'awaiting_payment', at = new Date('2090-03-10T05:00:00Z')) {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: user.id, status, departureDate: new Date('2091-01-01'), returnDate: new Date('2091-01-10'), season: 'regular', totalAmount: 1_500_000, createdAt: at } })
  bookings.push(b.id)
  for (const [type, sell, cost] of [['hotel', 1_000_000, 800_000], ['visa', 500_000, 400_000]] as const) {
    await prisma.priceSnapshot.create({ data: { bookingId: b.id, itemType: type, itemId: `${b.id}-${type}`, itemLabel: type === 'hotel' ? 'Hotel Uji' : 'Visa Uji', itemQty: 1, description: type, qty: 1, unit: 'item', unitSellIdr: sell, totalSellIdr: sell, unitCostIdr: cost, totalCostIdr: cost, mode: 'auto' } })
  }
  return b.id
}
const state2 = (id: string) => state(id)
const state = async (id: string) => {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id } })
  const s = await prisma.priceSnapshot.aggregate({ where: { bookingId: id }, _sum: { totalSellIdr: true }, _count: true })
  return { total: Number(b.totalAmount), sum: Number(s._sum.totalSellIdr), lines: s._count }
}
const rejectsAdj = (fn: () => Promise<unknown>, status: number, re: RegExp) => assert.rejects(fn, (e: unknown) => e instanceof AdjustmentError && e.status === status && re.test((e as Error).message))

await t('diskon di atas HPP: total turun, SATU baris snapshot `penyesuaian` (modal null, mode manual), total = Σ snapshot, catatan opsional, jejak siapa/total sebelum-sesudah', async () => {
  const id = await mkBooking()
  const r = await adjustBookingTotal({ bookingId: id, amountIdr: -100_000, label: 'Diskon rombongan', byUserId: staff.id })
  assert.deepEqual([r.totalBefore, r.totalAfter, r.belowCost, r.costKnownIdr], [1_500_000, 1_400_000, false, 1_200_000])
  assert.deepEqual(await state(id), { total: 1_400_000, sum: 1_400_000, lines: 3 })
  const line = await prisma.priceSnapshot.findFirstOrThrow({ where: { bookingId: id, itemType: 'booking' } })
  assert.deepEqual([line.lineKey, line.itemId, line.itemLabel, Number(line.totalSellIdr), line.totalCostIdr, line.mode], ['penyesuaian', r.adjustmentId, 'Diskon rombongan', -100_000, null, 'manual'])
  const [adj] = await listAdjustments(id)
  assert.deepEqual([adj!.amountIdr, adj!.totalBefore, adj!.totalAfter, adj!.belowCost, adj!.reason, adj!.byUserId, adj!.byName, adj!.reversed], [-100_000, 1_500_000, 1_400_000, false, null, staff.id, 'Admin Uji', false])
})
await t('biaya tambahan (positif) menaikkan total; Σ snapshot tetap sama dengan total', async () => {
  const id = await mkBooking()
  await adjustBookingTotal({ bookingId: id, amountIdr: 250_000, label: 'Biaya pengiriman dokumen', byUserId: staff.id })
  assert.deepEqual(await state(id), { total: 1_750_000, sum: 1_750_000, lines: 3 })
})
await t('Fase 8A: baris snapshot penyesuaian membawa rekomendasi 0 (diskon/biaya tambahan bukan bagian rekomendasi), bukan NULL', async () => {
  const id = await mkBooking()
  await adjustBookingTotal({ bookingId: id, amountIdr: -100_000, label: 'Diskon', byUserId: staff.id })
  const rows = await prisma.priceSnapshot.findMany({ where: { bookingId: id, lineKey: 'penyesuaian' } })
  assert.deepEqual(rows.map(r => Number(r.recommendedTotalIdr)), [0])
  assert.notEqual(rows[0]!.recommendedTotalIdr, null)
})
await t('DI BAWAH HPP: tanpa catatan ditolak (400, tak ada yang berubah); dengan catatan boleh dan belowCost tercatat; batas persis = HPP (tidak di bawah) tak butuh catatan', async () => {
  const id = await mkBooking()
  await rejectsAdj(() => adjustBookingTotal({ bookingId: id, amountIdr: -350_000, label: 'Nego', byUserId: staff.id }), 400, /catatan alasan wajib/) // 1.150.000 < HPP 1.200.000
  await rejectsAdj(() => adjustBookingTotal({ bookingId: id, amountIdr: -350_000, label: 'Nego', reason: 'ab', byUserId: staff.id }), 400, /catatan alasan wajib/)
  assert.deepEqual(await state(id), { total: 1_500_000, sum: 1_500_000, lines: 2 })
  const exact = await adjustBookingTotal({ bookingId: id, amountIdr: -300_000, label: 'Nego', byUserId: staff.id }) // 1.200.000 = HPP persis → tidak < HPP, tanpa catatan boleh
  assert.equal(exact.belowCost, false)
  const id2 = await mkBooking()
  const r = await adjustBookingTotal({ bookingId: id2, amountIdr: -400_000, label: 'Nego besar', reason: 'pelanggan loyal, kesepakatan manajer', byUserId: staff.id })
  assert.deepEqual([r.totalAfter, r.belowCost], [1_100_000, true])
  assert.equal((await listAdjustments(id2))[0]!.reason, 'pelanggan loyal, kesepakatan manajer')
})
await t('CHECK DB (bukan hanya kode): belowCost tak konsisten dengan total/HPP, total tak = sebelum + jumlah, total akhir ≤ 0, jumlah 0 → semua ditolak', async () => {
  const id = await mkBooking()
  const ins = (cols: Record<string, string>) => prisma.$executeRawUnsafe(`INSERT INTO booking_adjustments (id, "bookingId", "amountIdr", label, reason, "totalBefore", "totalAfter", "costKnownIdr", "belowCost", "byUserId") VALUES ('${tag}-chk${++n}', '${id}', ${cols.amount}, 'L', ${cols.reason}, ${cols.before}, ${cols.after}, ${cols.cost}, ${cols.below}, 'x')`)
  await ins({ amount: '-400000', reason: 'NULL', before: '1500000', after: '1100000', cost: '1200000', below: 'true' }) // Fase 8A: di bawah HPP tanpa catatan TIDAK lagi ditolak DB (peringatan, bukan larangan)
  await prisma.bookingAdjustment.deleteMany({ where: { bookingId: id } })
  await assert.rejects(() => ins({ amount: '-100000', reason: "'x ok ok'", before: '1500000', after: '1400000', cost: '1200000', below: 'true' }), /below_cost_consistent|check/i)
  await assert.rejects(() => ins({ amount: '-100000', reason: 'NULL', before: '1500000', after: '1300000', cost: '1200000', below: 'false' }), /total_consistent|check/i)
  await assert.rejects(() => ins({ amount: '-1500000', reason: "'alasan jelas'", before: '1500000', after: '0', cost: '1200000', below: 'true' }), /total_after_positive|check/i)
  await assert.rejects(() => ins({ amount: '0', reason: 'NULL', before: '1500000', after: '1500000', cost: '1200000', below: 'false' }), /nonzero|check/i)
  assert.equal(await prisma.bookingAdjustment.count({ where: { bookingId: id } }), 0)
})
await t('masukan: total akhir ≤ 0 → 422; jumlah 0/NaN/Infinity/melebihi batas → 400; label kosong/terlalu panjang → 400; pesanan tak ada → 404', async () => {
  const id = await mkBooking()
  await rejectsAdj(() => adjustBookingTotal({ bookingId: id, amountIdr: -1_500_000, label: 'Gratis', reason: 'uji', byUserId: staff.id }), 422, /lebih dari 0/)
  for (const bad of [0, Number.NaN, Number.POSITIVE_INFINITY, 6_000_000_000]) await rejectsAdj(() => adjustBookingTotal({ bookingId: id, amountIdr: bad, label: 'X', byUserId: staff.id }), 400, /tidak valid/)
  await rejectsAdj(() => adjustBookingTotal({ bookingId: id, amountIdr: -1000, label: '   ', byUserId: staff.id }), 400, /Label/)
  await rejectsAdj(() => adjustBookingTotal({ bookingId: id, amountIdr: -1000, label: 'x'.repeat(121), byUserId: staff.id }), 400, /Label/)
  await rejectsAdj(() => adjustBookingTotal({ bookingId: '00000000-0000-4000-8000-000000000000', amountIdr: -1000, label: 'X', byUserId: staff.id }), 404, /tidak ditemukan/)
  assert.deepEqual(await state(id), { total: 1_500_000, sum: 1_500_000, lines: 2 })
})
await t('HANYA saat menunggu pembayaran: payment_review / confirmed / cancelled → 409 dan tak ada yang berubah', async () => {
  for (const status of ['payment_review', 'confirmed', 'cancelled'] as const) {
    const id = await mkBooking(status)
    await rejectsAdj(() => adjustBookingTotal({ bookingId: id, amountIdr: -1000, label: 'X', byUserId: staff.id }), 409, /menunggu pembayaran/)
    assert.deepEqual(await state(id), { total: 1_500_000, sum: 1_500_000, lines: 2 })
  }
})
await t('total ≠ Σ snapshot (data rusak) → ditolak 409, bukan diperparah', async () => {
  const id = await mkBooking()
  await prisma.booking.update({ where: { id }, data: { totalAmount: 1_499_999 } })
  await rejectsAdj(() => adjustBookingTotal({ bookingId: id, amountIdr: -1000, label: 'X', byUserId: staff.id }), 409, /tidak sama dengan jumlah rincian/)
})
await t('PEMBATALAN lewat baris pembalik: total kembali, snapshot bertambah satu baris (tak ada UPDATE/DELETE), sekali saja; pembalik tak bisa dibatalkan; lintas pesanan 404', async () => {
  const id = await mkBooking(), other = await mkBooking()
  const a = await adjustBookingTotal({ bookingId: id, amountIdr: -100_000, label: 'Diskon A', byUserId: staff.id })
  const rev = await reverseAdjustment({ bookingId: id, adjustmentId: a.adjustmentId, byUserId: staff.id })
  assert.deepEqual([rev.totalBefore, rev.totalAfter], [1_400_000, 1_500_000])
  assert.deepEqual(await state(id), { total: 1_500_000, sum: 1_500_000, lines: 4 })
  const list = await listAdjustments(id)
  assert.deepEqual(list.map(x => [x.amountIdr, x.reversed, x.reversesId === a.adjustmentId, x.label]).sort(), [[-100_000, true, false, 'Diskon A'], [100_000, false, true, 'Pembatalan: Diskon A']].sort())
  await assert.rejects(() => reverseAdjustment({ bookingId: id, adjustmentId: a.adjustmentId, byUserId: staff.id }), (e: unknown) => e instanceof AdjustmentError && e.status === 409 && /sudah dibatalkan/.test((e as Error).message))
  await assert.rejects(() => reverseAdjustment({ bookingId: id, adjustmentId: rev.adjustmentId, byUserId: staff.id }), (e: unknown) => e instanceof AdjustmentError && e.status === 409 && /tidak dapat dibatalkan lagi/.test((e as Error).message))
  const b = await adjustBookingTotal({ bookingId: other, amountIdr: -5000, label: 'Lain', byUserId: staff.id })
  await assert.rejects(() => reverseAdjustment({ bookingId: id, adjustmentId: b.adjustmentId, byUserId: staff.id }), (e: unknown) => e instanceof AdjustmentError && e.status === 404)
})
await t('pembatalan memerlukan menunggu-bayar; membatalkan diskon di bawah HPP menaikkan total (tak butuh catatan baru)', async () => {
  const id = await mkBooking()
  const a = await adjustBookingTotal({ bookingId: id, amountIdr: -400_000, label: 'Nego', reason: 'kesepakatan', byUserId: staff.id })
  await prisma.booking.update({ where: { id }, data: { status: 'payment_review' } })
  await rejectsAdj(() => reverseAdjustment({ bookingId: id, adjustmentId: a.adjustmentId, byUserId: staff.id }), 409, /menunggu pembayaran/)
  await prisma.booking.update({ where: { id }, data: { status: 'awaiting_payment' } })
  const rev = await reverseAdjustment({ bookingId: id, adjustmentId: a.adjustmentId, byUserId: staff.id })
  assert.deepEqual([rev.totalAfter, rev.belowCost], [1_500_000, false])
})
await t('PARALEL: 6 penyesuaian −10.000 bersamaan → total turun tepat 60.000 dan Σ snapshot = total (baris booking terkunci)', async () => {
  const id = await mkBooking()
  const res = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => adjustBookingTotal({ bookingId: id, amountIdr: -10_000, label: `Paralel ${i}`, byUserId: staff.id })))
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 6, res.filter(r => r.status === 'rejected').map(r => String((r as PromiseRejectedResult).reason)).join('; '))
  assert.deepEqual(await state(id), { total: 1_440_000, sum: 1_440_000, lines: 8 })
})
await t('KUNCI BARIS: penyesuaian MENUNGGU kunci FOR UPDATE pada baris booking (dua penyesuaian tak membaca total lama yang sama)', async () => {
  const id = await mkBooking()
  let pending: Promise<unknown> | undefined
  let state = ''
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe(`SELECT "id" FROM "bookings" WHERE "id" = $1 FOR UPDATE`, id)
    pending = adjustBookingTotal({ bookingId: id, amountIdr: -1000, label: 'Tunggu', byUserId: staff.id })
    state = await Promise.race([pending.then(() => 'done'), new Promise<string>(r => setTimeout(() => r('blocked'), 400))])
  })
  assert.equal(state, 'blocked'); await pending
  assert.deepEqual(await state2(id), { total: 1_499_000, sum: 1_499_000, lines: 3 })
})
await t('snapshot tetap BEKU: UPDATE baris penyesuaian ditolak DB', async () => {
  const id = await mkBooking()
  const a = await adjustBookingTotal({ bookingId: id, amountIdr: -1000, label: 'X', byUserId: staff.id })
  await assert.rejects(() => prisma.priceSnapshot.updateMany({ where: { itemId: a.adjustmentId }, data: { totalSellIdr: 1 } }), /beku/)
})
await t('INVOICE: label tampil sebagai baris tersendiri, jumlah = total; CATATAN INTERNAL tak pernah muncul di data invoice', async () => {
  const id = await mkBooking()
  await adjustBookingTotal({ bookingId: id, amountIdr: -400_000, label: 'Diskon rombongan', reason: 'RAHASIA-nego-manajer', byUserId: staff.id })
  const inv = await buildInvoiceData(await prisma.booking.findUniqueOrThrow({ where: { id }, include: invoiceBookingInclude }))
  assert.deepEqual(inv.lineItems.map(l => [l.label.replace(/ — .*$/, ''), l.amount]), [['Hotel Uji', 1_000_000], ['Visa Uji', 500_000], ['Diskon rombongan', -400_000]])
  assert.deepEqual([inv.subtotal, inv.totalAmount], [1_100_000, 1_100_000])
  assert.doesNotMatch(JSON.stringify(inv), /RAHASIA|nego-manajer/)
})
await t('LAPORAN UNTUNG: penyesuaian bermodal 0 → untung ikut turun (jual 1.400.000 − modal 1.200.000 = 200.000); pesanan di bawah HPP terlihat rugi', async () => {
  const id = await mkBooking('confirmed', new Date('2090-09-10T05:00:00Z'))
  // dikonfirmasi lewat jalur lama: sesuaikan saat awaiting lalu ubah status (jalur nyata: diskon sebelum bayar)
  await prisma.booking.update({ where: { id }, data: { status: 'awaiting_payment' } })
  await adjustBookingTotal({ bookingId: id, amountIdr: -100_000, label: 'Diskon', byUserId: staff.id })
  await prisma.booking.update({ where: { id }, data: { status: 'confirmed' } })
  const r = await getProfitReport({ from: '2090-09-01', to: '2090-09-30', scope: 'recognized' })
  assert.deepEqual([r.summary.sellIdr, r.summary.costKnownIdr, r.summary.profitIdr], [1_400_000, 1_200_000, 200_000])
})

// ── jumlah pembayaran terkonfirmasi (7A) ─────────────────────────────────────────────────────────────────────────────
await t('aturan jumlah (murni): bawaan = total; sama dengan total tanpa catatan; LEBIH dari total wajib catatan ≥ 3; KURANG dari total ditolak (bahkan bercatatan); 0/negatif/NaN/melebihi batas ditolak', () => {
  assert.equal(resolveConfirmedAmount(1_500_000, {}), 1_500_000)
  assert.equal(resolveConfirmedAmount(1_500_000, { amount: 1_500_000 }), 1_500_000)
  assert.equal(resolveConfirmedAmount(1_500_000, { amount: 1_600_000, notes: 'lebih bayar, rencana pengembalian' }), 1_600_000)
  for (const input of [{ amount: 1_600_000 }, { amount: 1_600_000, notes: 'ab' }, { amount: 1_600_000, notes: '  ' }]) assert.throws(() => resolveConfirmedAmount(1_500_000, input), (e: unknown) => e instanceof PaymentAmountError && /lebih dari total/.test((e as Error).message))
  for (const input of [{ amount: 1_000_000 }, { amount: 1_499_999.99, notes: 'kurang bayar, sisa menyusul' }]) assert.throws(() => resolveConfirmedAmount(1_500_000, input), (e: unknown) => e instanceof PaymentAmountError && /kurang dari total/.test((e as Error).message))
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 6_000_000_000]) assert.throws(() => resolveConfirmedAmount(1_500_000, { amount, notes: 'catatan ok' }), PaymentAmountError)
})

// ── pemrosesan pembayaran (7A + audit M1/M2): status dibaca ulang di dalam kunci ─────────────────────────────────────────
const mkPaid = async (bookingStatus: 'payment_review' | 'awaiting_payment' | 'cancelled' | 'confirmed' = 'payment_review', payStatus: 'pending' | 'confirmed' | 'rejected' = 'pending') => {
  const id = await mkBooking(bookingStatus)
  const pay = await prisma.payment.create({ data: { bookingId: id, amount: payStatus === 'confirmed' ? 1_500_000 : 0, method: 'bank_transfer', status: payStatus } })
  return { id, pay: pay.id }
}
const snap = async (bookingId: string, payId: string) => {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }); const p = await prisma.payment.findUniqueOrThrow({ where: { id: payId } })
  return { booking: b.status, pay: p.status, amount: Number(p.amount), notes: p.notes, confirmedAt: p.confirmedAt?.toISOString() ?? null }
}
await t('KONFIRMASI: bawaan jumlah = total pesanan, status payment confirmed + booking confirmed, siapa/kapan tercatat; jumlah tersimpan dibaca invoice (sisa tagihan 0)', async () => {
  const { id, pay } = await mkPaid()
  const r = await processPayment(pay, { action: 'confirm', byUserId: staff.id })
  assert.equal(r.kind, 'done')
  const s2 = await snap(id, pay)
  assert.deepEqual([s2.booking, s2.pay, s2.amount], ['confirmed', 'confirmed', 1_500_000])
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: pay } })).confirmedById, staff.id)
  const inv = await buildInvoiceData(await prisma.booking.findUniqueOrThrow({ where: { id }, include: invoiceBookingInclude }))
  assert.deepEqual([inv.balanceDue, inv.totalAmount], [0, 1_500_000])
})
await t('invoice: pembayaran PENDING → sisa tagihan = total penuh; jumlah terkonfirmasi lebih kecil dari total tak pernah tampil lunas (data lama/koreksi manual)', async () => {
  const p = await mkPaid()
  const inv = await buildInvoiceData(await prisma.booking.findUniqueOrThrow({ where: { id: p.id }, include: invoiceBookingInclude }))
  assert.equal(inv.balanceDue, 1_500_000)
  await prisma.payment.update({ where: { id: p.pay }, data: { status: 'confirmed', amount: 1_000_000 } })
  const inv2 = await buildInvoiceData(await prisma.booking.findUniqueOrThrow({ where: { id: p.id }, include: invoiceBookingInclude }))
  assert.equal(inv2.balanceDue, 500_000)
})
await t('KURANG dari total ditolak (tak ada yang berubah); LEBIH tanpa catatan ditolak, dengan catatan sah dan tersimpan', async () => {
  const a = await mkPaid()
  await assert.rejects(() => processPayment(a.pay, { action: 'confirm', amount: 1_000_000, notes: 'kurang bayar', byUserId: staff.id }), (e: unknown) => e instanceof PaymentAmountError)
  assert.deepEqual(await snap(a.id, a.pay), { booking: 'payment_review', pay: 'pending', amount: 0, notes: null, confirmedAt: null })
  await assert.rejects(() => processPayment(a.pay, { action: 'confirm', amount: 1_700_000, byUserId: staff.id }), (e: unknown) => e instanceof PaymentAmountError)
  assert.equal((await processPayment(a.pay, { action: 'confirm', amount: 1_700_000, notes: 'lebih bayar 200 rb', byUserId: staff.id })).kind, 'done')
  assert.deepEqual([(await snap(a.id, a.pay)).amount, (await snap(a.id, a.pay)).notes], [1_700_000, 'lebih bayar 200 rb'])
})
await t('GANDA/BASI ditolak (conflict, tak ada yang berubah): konfirmasi dua kali, tolak setelah konfirmasi, konfirmasi payment yang sudah ditolak, pesanan batal / belum waktunya, id tak ada', async () => {
  const a = await mkPaid()
  assert.equal((await processPayment(a.pay, { action: 'confirm', byUserId: staff.id })).kind, 'done')
  const before = await snap(a.id, a.pay)
  assert.equal((await processPayment(a.pay, { action: 'confirm', amount: 1_900_000, notes: 'timpa jumlah', byUserId: staff.id })).kind, 'conflict')
  assert.equal((await processPayment(a.pay, { action: 'reject', notes: 'tolak setelah bayar', byUserId: staff.id })).kind, 'conflict')
  assert.deepEqual(await snap(a.id, a.pay), before, 'jumlah final tak tertimpa; booking tetap confirmed')
  const r = await mkPaid()
  assert.equal((await processPayment(r.pay, { action: 'reject', notes: 'bukti buram', byUserId: staff.id })).kind, 'done')
  assert.deepEqual([(await snap(r.id, r.pay)).booking, (await snap(r.id, r.pay)).pay], ['awaiting_payment', 'rejected'])
  assert.equal((await processPayment(r.pay, { action: 'confirm', byUserId: staff.id })).kind, 'conflict')
  const c = await mkPaid('cancelled')
  assert.equal((await processPayment(c.pay, { action: 'confirm', byUserId: staff.id })).kind, 'conflict')
  assert.equal((await snap(c.id, c.pay)).booking, 'cancelled', 'booking batal tak dihidupkan kembali')
  const w = await mkPaid('awaiting_payment')
  assert.equal((await processPayment(w.pay, { action: 'confirm', byUserId: staff.id })).kind, 'conflict')
  assert.equal((await processPayment('00000000-0000-4000-8000-000000000000', { action: 'confirm', byUserId: staff.id })).kind, 'not_found')
})
await t('PARALEL: 6 konfirmasi serentak pada payment yang sama → TEPAT satu berhasil (sisanya conflict), jumlah/status tunggal', async () => {
  const a = await mkPaid()
  const res = await Promise.all(Array.from({ length: 6 }, () => processPayment(a.pay, { action: 'confirm', byUserId: staff.id })))
  assert.deepEqual([res.filter(r => r.kind === 'done').length, res.filter(r => r.kind === 'conflict').length], [1, 5])
  assert.deepEqual(await snap(a.id, a.pay).then(x => [x.booking, x.pay, x.amount]), ['confirmed', 'confirmed', 1_500_000])
})
await t('AUDIT L2: pembatalan yang menghasilkan total DI BAWAH HPP wajib catatan manusia (bukan catatan otomatis sistem); di atas HPP catatan otomatis boleh', async () => {
  const id = await mkBooking()
  const surcharge = await adjustBookingTotal({ bookingId: id, amountIdr: 100_000, label: 'Biaya tambahan', byUserId: staff.id })   // 1.600.000
  await adjustBookingTotal({ bookingId: id, amountIdr: -350_000, label: 'Diskon', byUserId: staff.id })                          // 1.250.000 ≥ HPP 1.200.000 → tanpa catatan
  await rejectsAdj(() => reverseAdjustment({ bookingId: id, adjustmentId: surcharge.adjustmentId, byUserId: staff.id }), 400, /catatan alasan wajib/) // → 1.150.000 < HPP
  assert.deepEqual(await state(id), { total: 1_250_000, sum: 1_250_000, lines: 4 })
  const rev = await reverseAdjustment({ bookingId: id, adjustmentId: surcharge.adjustmentId, reason: 'biaya tambahan dibatalkan atas permintaan manajer', byUserId: staff.id })
  assert.deepEqual([rev.totalAfter, rev.belowCost], [1_150_000, true])
  const ok2 = await mkBooking(); const d = await adjustBookingTotal({ bookingId: ok2, amountIdr: -100_000, label: 'D', byUserId: staff.id })
  await reverseAdjustment({ bookingId: ok2, adjustmentId: d.adjustmentId, byUserId: staff.id })
  assert.match((await listAdjustments(ok2)).find(x => x.reversesId)!.reason ?? '', /^Pembatalan penyesuaian/)
})
await t('AUDIT L1: label penyesuaian TIDAK memengaruhi laporan — diskon berlabel "Penyesuaian data lama" tetap bermodal 0 (untung turun, tak menyelinap ke "tanpa modal")', async () => {
  const id = await mkBooking('confirmed', new Date('2090-10-10T05:00:00Z'))
  await prisma.booking.update({ where: { id }, data: { status: 'awaiting_payment' } })
  await adjustBookingTotal({ bookingId: id, amountIdr: -300_000, label: 'Penyesuaian data lama', reason: 'uji penyamaran', byUserId: staff.id })
  await prisma.booking.update({ where: { id }, data: { status: 'confirmed' } })
  const r = await getProfitReport({ from: '2090-10-01', to: '2090-10-31', scope: 'recognized' })
  assert.deepEqual([r.summary.sellIdr, r.summary.sellUnknownCostIdr, r.summary.profitIdr], [1_200_000, 0, 0])
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
await t('PENJAGA: route penyesuaian dijaga policy di awal; konfirmasi bayar memakai resolveConfirmedAmount + skema .strict(); hanya lib/booking/adjustments.ts (+ pembersihan UU PDP) menulis booking_adjustments; catatan internal tak ada di invoice', () => {
  for (const f of ['app/api/v1/admin/bookings/[id]/adjustments/route.ts', 'app/api/v1/admin/bookings/[id]/adjustments/[adjId]/reverse/route.ts']) {
    const src = read(f)
    assert.match(src, /requireBookingAdjust\(\)|requirePricingView\(\)/, f); assert.doesNotMatch(src, /requireManager|requireSuperAdmin|requireAdmin\(/, f)
    assert.doesNotMatch(src, /priceSnapshot|bookingAdjustment/, `${f}: route tak menyentuh tabel langsung`)
  }
  const confirm = read('app/api/v1/admin/payments/[id]/confirm/route.ts')
  assert.match(confirm, /processPayment\(/); assert.match(confirm, /\.strict\(\)/)
  const proc = read('lib/payments/process.ts')
  assert.match(proc, /FOR UPDATE/); assert.match(proc, /resolveConfirmedAmount\(/); assert.match(proc, /payment\.status !== 'pending' \|\| booking\.status !== 'payment_review'/)
  assert.doesNotMatch(read('app/api/v1/bookings/[id]/route.ts'), /payments:\s*\{ orderBy: \{ createdAt: 'desc' \}, take: 1 \}/, 'catatan staf pembayaran tak boleh ikut ke jamaah')
  const walk = (dir: string, out: string[] = []): string[] => { for (const f of readdirSync(dir)) { if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue; const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p) } return out }
  const writers = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'components'))].filter(f => /bookingAdjustment\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\b/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(writers.map(f => f.slice(root.length)).sort(), ['lib/account/deletion.ts', 'lib/booking/adjustments.ts'], 'penulis: modul ini + pembersihan catatan staf saat hapus akun (UU PDP)')
  assert.doesNotMatch(read('lib/pdf/invoiceData.ts'), /bookingAdjustment|reason/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.payment.deleteMany({ where: { bookingId: { in: bookings } } })
await prisma.booking.deleteMany({ where: { id: { in: bookings } } }) // cascade: snapshot + penyesuaian
await prisma.user.deleteMany({ where: { id: { in: [user.id, staff.id] } } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
