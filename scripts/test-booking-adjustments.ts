// Fase 7 harga terpadu (docs/arsitektur-harga-terpadu.md §20, 7A+7B): penyesuaian total pesanan (diskon/biaya tambahan) dan jumlah pembayaran terkonfirmasi, terhadap DATABASE SUNGGUHAN.
// Dibuktikan: total = Σ snapshot tetap (satu baris `penyesuaian` per perubahan, tanpa UPDATE snapshot), di bawah HPP/rekomendasi hanya PERINGATAN (tak pernah menolak; catatan opsional), hanya saat menunggu
// pembayaran, total akhir > 0, pembatalan lewat baris pembalik (sekali), perubahan paralel terkunci, label tampil di invoice tetapi catatan INTERNAL tak pernah bocor, laba laporan ikut berkurang,
// serta aturan jumlah pembayaran dan penjaga sumber.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { AdjustmentError, adjustBookingTotal, listAdjustments, reverseAdjustment, setBookingTotal, updateAdjustmentReason } from '@/lib/booking/adjustments'
import { buildInvoiceData, invoiceBookingInclude } from '@/lib/pdf/invoiceData'
import { getProfitReport } from '@/lib/reports/profit'
import { PaymentAmountError, resolveConfirmedAmount } from '@/lib/payments/confirmAmount'
import { processPayment } from '@/lib/payments/process'
import { assertThrowawayDb } from './lib/testDb'
import { legacyBookingState, type LegacyBookingStatus } from './lib/legacyStatus'
import { displayStatus } from '@/lib/booking/lifecycle'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `adj${Date.now()}`
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Penyesuaian', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const staff = await prisma.user.create({ data: { email: `${tag}-staff@example.test`, passwordHash: 'x', fullName: 'Admin Uji', role: 'admin', isActive: true, emailVerifiedAt: new Date() } })
const staff2 = await prisma.user.create({ data: { email: `${tag}-staff2@example.test`, passwordHash: 'x', fullName: 'Admin Dua', role: 'admin', isActive: true, emailVerifiedAt: new Date() } })
const bookings: string[] = []
let n = 0

/** Booking menunggu pembayaran: hotel jual 1.000.000 (modal 800.000) + visa jual 500.000 (modal 400.000) → total 1.500.000, HPP awal diketahui 1.200.000. */
async function mkBooking(status: LegacyBookingStatus = 'awaiting_payment', at = new Date('2090-03-10T05:00:00Z')) {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: user.id, ...legacyBookingState(status), departureDate: new Date('2091-01-01'), returnDate: new Date('2091-01-10'), season: 'regular', totalAmount: 1_500_000, createdAt: at } })
  bookings.push(b.id)
  if (status === 'payment_review') await prisma.payment.create({ data: { bookingId: b.id, amount: 0, method: 'bank_transfer', status: 'pending' } }) // bukti menunggu verifikasi
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
await t('DI BAWAH HPP (Fase 8): TIDAK ditolak walau tanpa catatan — belowCost tercatat, peringatan below_cost dikembalikan; catatan opsional tersimpan bila ada', async () => {
  const id = await mkBooking()
  const first = await adjustBookingTotal({ bookingId: id, amountIdr: -350_000, label: 'Nego', byUserId: staff.id }) // 1.150.000 < HPP 1.200.000, tanpa catatan
  assert.deepEqual([first.totalAfter, first.belowCost, first.warningAfter.level, first.warningAfter.lossIdr, first.warningBefore.level], [1_150_000, true, 'below_cost', 50_000, 'ok'])
  assert.deepEqual(await state(id), { total: 1_150_000, sum: 1_150_000, lines: 3 })
  assert.equal((await listAdjustments(id))[0]!.reason, null)
  const id2 = await mkBooking()
  const exact = await adjustBookingTotal({ bookingId: id2, amountIdr: -300_000, label: 'Nego', byUserId: staff.id }) // 1.200.000 = HPP persis: tidak rugi, tapi di bawah rekomendasi 1.500.000
  assert.deepEqual([exact.belowCost, exact.warningAfter.level, exact.warningAfter.shortfallVsRecommendedIdr], [false, 'below_recommended', 300_000])
  const id3 = await mkBooking()
  const r = await adjustBookingTotal({ bookingId: id3, amountIdr: -400_000, label: 'Nego besar', reason: 'pelanggan loyal, kesepakatan manajer', byUserId: staff.id })
  assert.deepEqual([r.totalAfter, r.belowCost], [1_100_000, true])
  assert.equal((await listAdjustments(id3))[0]!.reason, 'pelanggan loyal, kesepakatan manajer')
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
  await prisma.booking.update({ where: { id }, data: legacyBookingState('payment_review') })
  await prisma.payment.create({ data: { bookingId: id, amount: 0, method: 'bank_transfer', status: 'pending' } }) // bukti menunggu verifikasi = payment `pending`
  await rejectsAdj(() => reverseAdjustment({ bookingId: id, adjustmentId: a.adjustmentId, byUserId: staff.id }), 409, /menunggu pembayaran/)
  await prisma.booking.update({ where: { id }, data: legacyBookingState('awaiting_payment') })
  await prisma.payment.deleteMany({ where: { bookingId: id, status: 'pending' } })
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
  await prisma.booking.update({ where: { id }, data: legacyBookingState('awaiting_payment') })
  await prisma.payment.deleteMany({ where: { bookingId: id, status: 'pending' } })
  await adjustBookingTotal({ bookingId: id, amountIdr: -100_000, label: 'Diskon', byUserId: staff.id })
  await prisma.booking.update({ where: { id }, data: legacyBookingState('confirmed') })
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
const mkPaid = async (bookingStatus: LegacyBookingStatus = 'payment_review', payStatus: 'pending' | 'confirmed' | 'rejected' = 'pending') => {
  const id = await mkBooking(bookingStatus === 'payment_review' ? 'awaiting_payment' : bookingStatus) // bukti menunggu = payment `pending` yang dibuat di bawah
  const pay = await prisma.payment.create({ data: { bookingId: id, amount: payStatus === 'confirmed' ? 1_500_000 : 0, method: 'bank_transfer', status: payStatus } })
  return { id, pay: pay.id }
}
const snap = async (bookingId: string, payId: string) => {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }); const p = await prisma.payment.findUniqueOrThrow({ where: { id: payId } })
  const pending = await prisma.payment.count({ where: { bookingId, status: 'pending' } })
  return { booking: displayStatus({ status: b.status, confirmedAt: b.confirmedAt, hasPendingPayment: pending > 0, departureDate: b.departureDate, returnDate: b.returnDate }), pay: p.status, amount: Number(p.amount), notes: p.notes, confirmedAt: p.confirmedAt?.toISOString() ?? null }
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
  const w = await mkPaid('confirmed') // sudah dikonfirmasi sebelumnya (confirmedAt terisi) lalu ada bukti kedua → tak diproses lagi
  assert.equal((await processPayment(w.pay, { action: 'confirm', byUserId: staff.id })).kind, 'conflict')
  assert.equal((await processPayment('00000000-0000-4000-8000-000000000000', { action: 'confirm', byUserId: staff.id })).kind, 'not_found')
})
await t('PARALEL: 6 konfirmasi serentak pada payment yang sama → TEPAT satu berhasil (sisanya conflict), jumlah/status tunggal', async () => {
  const a = await mkPaid()
  const res = await Promise.all(Array.from({ length: 6 }, () => processPayment(a.pay, { action: 'confirm', byUserId: staff.id })))
  assert.deepEqual([res.filter(r => r.kind === 'done').length, res.filter(r => r.kind === 'conflict').length], [1, 5])
  assert.deepEqual(await snap(a.id, a.pay).then(x => [x.booking, x.pay, x.amount]), ['confirmed', 'confirmed', 1_500_000])
})
await t('AUDIT L2 (Fase 8): pembatalan yang menghasilkan total DI BAWAH HPP tetap jalan — catatan manusia dipakai bila ada, selain itu catatan otomatis sistem', async () => {
  const id = await mkBooking()
  const surcharge = await adjustBookingTotal({ bookingId: id, amountIdr: 100_000, label: 'Biaya tambahan', byUserId: staff.id })   // 1.600.000
  await adjustBookingTotal({ bookingId: id, amountIdr: -350_000, label: 'Diskon', byUserId: staff.id })                          // 1.250.000 ≥ HPP 1.200.000
  const rev = await reverseAdjustment({ bookingId: id, adjustmentId: surcharge.adjustmentId, byUserId: staff.id })               // → 1.150.000 < HPP: tidak ditolak
  assert.deepEqual([rev.totalAfter, rev.belowCost, rev.warningAfter.level], [1_150_000, true, 'below_cost'])
  assert.match((await listAdjustments(id)).find(x => x.reversesId)!.reason ?? '', /^Pembatalan penyesuaian/)
  const human = await mkBooking(); const s2 = await adjustBookingTotal({ bookingId: human, amountIdr: 100_000, label: 'B', byUserId: staff.id })
  await adjustBookingTotal({ bookingId: human, amountIdr: -350_000, label: 'D', byUserId: staff.id })
  await reverseAdjustment({ bookingId: human, adjustmentId: s2.adjustmentId, reason: 'dibatalkan atas permintaan manajer', byUserId: staff.id })
  assert.equal((await listAdjustments(human)).find(x => x.reversesId)!.reason, 'dibatalkan atas permintaan manajer')
  const ok2 = await mkBooking(); const d = await adjustBookingTotal({ bookingId: ok2, amountIdr: -100_000, label: 'D', byUserId: staff.id })
  await reverseAdjustment({ bookingId: ok2, adjustmentId: d.adjustmentId, byUserId: staff.id })
  assert.match((await listAdjustments(ok2)).find(x => x.reversesId)!.reason ?? '', /^Pembatalan penyesuaian/)
})
await t('AUDIT L1: label penyesuaian TIDAK memengaruhi laporan — diskon berlabel "Penyesuaian data lama" tetap bermodal 0 (untung turun, tak menyelinap ke "tanpa modal")', async () => {
  const id = await mkBooking('confirmed', new Date('2090-10-10T05:00:00Z'))
  await prisma.booking.update({ where: { id }, data: legacyBookingState('awaiting_payment') })
  await prisma.payment.deleteMany({ where: { bookingId: id, status: 'pending' } })
  await adjustBookingTotal({ bookingId: id, amountIdr: -300_000, label: 'Penyesuaian data lama', reason: 'uji penyamaran', byUserId: staff.id })
  await prisma.booking.update({ where: { id }, data: legacyBookingState('confirmed') })
  const r = await getProfitReport({ from: '2090-10-01', to: '2090-10-31', scope: 'recognized' })
  assert.deepEqual([r.summary.sellIdr, r.summary.sellUnknownCostIdr, r.summary.profitIdr], [1_200_000, 0, 0])
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
await t('ATUR TOTAL (Fase 8C): turun ke bawah rekomendasi → lunak; ke bawah HPP → rugi; keduanya DITERIMA tanpa catatan; label bawaan dari tanda; total = Σ snapshot selalu', async () => {
  const id = await mkBooking() // HPP 1.200.000 · rekomendasi 1.500.000 · jual 1.500.000
  const same = await prisma.bookingAdjustment.count({ where: { bookingId: id } })
  await rejectsAdj(() => setBookingTotal({ bookingId: id, totalIdr: 1_500_000, byUserId: staff.id }), 400, /sudah sama/)
  assert.equal(await prisma.bookingAdjustment.count({ where: { bookingId: id } }), same)
  const soft = await setBookingTotal({ bookingId: id, totalIdr: 1_300_000, byUserId: staff.id })
  assert.deepEqual([soft.totalBefore, soft.totalAfter, soft.warningAfter.level, soft.warningAfter.shortfallVsRecommendedIdr, soft.belowCost], [1_500_000, 1_300_000, 'below_recommended', 200_000, false])
  assert.deepEqual(await state(id), { total: 1_300_000, sum: 1_300_000, lines: 3 })
  const loss = await setBookingTotal({ bookingId: id, totalIdr: 1_000_000, label: 'Nego akhir', byUserId: staff.id })
  assert.deepEqual([loss.totalBefore, loss.totalAfter, loss.warningBefore.level, loss.warningAfter.level, loss.warningAfter.lossIdr, loss.belowCost], [1_300_000, 1_000_000, 'below_recommended', 'below_cost', 200_000, true])
  const up = await setBookingTotal({ bookingId: id, totalIdr: 1_800_000, byUserId: staff.id }) // "edit" = atur lagi: baris baru, label dari tanda (+)
  assert.deepEqual([up.totalAfter, up.warningAfter.level], [1_800_000, 'ok'])
  assert.deepEqual(await state(id), { total: 1_800_000, sum: 1_800_000, lines: 5 })
  const hist = await listAdjustments(id)
  assert.deepEqual(hist.map(h => [h.label, h.amountIdr]), [['Biaya tambahan', 800_000], ['Nego akhir', -300_000], ['Diskon', -200_000]])
})
await t('ATUR TOTAL: yang ditolak hanya total ≤ 0 / bukan angka (422/400, tak ada yang berubah), status selain menunggu pembayaran (409), pesanan tak ada (404); batas wajar', async () => {
  const id = await mkBooking()
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) await rejectsAdj(() => setBookingTotal({ bookingId: id, totalIdr: bad, byUserId: staff.id }), 422, /lebih dari 0/)
  await rejectsAdj(() => setBookingTotal({ bookingId: id, totalIdr: 9_000_000_000_000, byUserId: staff.id }), 400, /Total melebihi batas wajar/)
  await rejectsAdj(() => setBookingTotal({ bookingId: id, totalIdr: 5_000_000_001, byUserId: staff.id }), 400, /Total melebihi batas wajar/)
  await rejectsAdj(() => adjustBookingTotal({ bookingId: id, amountIdr: 4_999_999_999, label: 'Naik', byUserId: staff.id }), 400, /Total melebihi batas wajar/) // 1,5 jt + 4,99 miliar > 5 miliar
  assert.equal((await setBookingTotal({ bookingId: id, totalIdr: 5_000_000_000, byUserId: staff.id })).totalAfter, 5_000_000_000, 'tepat di batas boleh')
  assert.equal((await setBookingTotal({ bookingId: id, totalIdr: 1_500_000, byUserId: staff.id })).totalAfter, 1_500_000, 'menurunkan selalu boleh')
  await rejectsAdj(() => setBookingTotal({ bookingId: id, totalIdr: 1_000_000, reason: 'x'.repeat(501), byUserId: staff.id }), 400, /maksimal 500/)
  await rejectsAdj(() => setBookingTotal({ bookingId: id, totalIdr: 1_000_000, label: 'L'.repeat(121), byUserId: staff.id }), 400, /Label/)
  assert.deepEqual(await state(id), { total: 1_500_000, sum: 1_500_000, lines: 2 + 2 })
  const review = await mkBooking('payment_review')
  await rejectsAdj(() => setBookingTotal({ bookingId: review, totalIdr: 1_000_000, byUserId: staff.id }), 409, /menunggu pembayaran/)
  await rejectsAdj(() => setBookingTotal({ bookingId: '00000000-0000-0000-0000-000000000000', totalIdr: 1_000_000, byUserId: staff.id }), 404, /tidak ditemukan/)
})
await t('ATUR TOTAL: dua orang mengatur bersamaan dari total yang sama → keduanya berhasil berurutan (selisih dihitung dari total terkini di dalam kunci), Σ snapshot = total akhir = salah satu nilai yang diminta; baris booking dikunci (diuji deterministik)', async () => {
  const id = await mkBooking()
  const res = await Promise.allSettled([1_400_000, 1_100_000, 1_700_000, 900_000].map(t2 => setBookingTotal({ bookingId: id, totalIdr: t2, byUserId: staff.id })))
  assert.ok(res.every(r => r.status === 'fulfilled'), JSON.stringify(res.filter(r => r.status === 'rejected')))
  const st = await state(id)
  assert.equal(st.total, st.sum)
  assert.ok([1_400_000, 1_100_000, 1_700_000, 900_000].includes(st.total))
  assert.equal(st.lines, 2 + 4)
  // deterministik: selama ada pemegang kunci baris booking, pengatur total menunggu (tidak membaca total basi)
  const id2 = await mkBooking()
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const holder = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "bookings" WHERE "id" = ${id2} FOR SHARE`; await held }, { timeout: 20_000 })
  await new Promise(r => setTimeout(r, 300))
  let done = false
  const pending = setBookingTotal({ bookingId: id2, totalIdr: 1_000_000, byUserId: staff.id }).then(() => { done = true })
  await new Promise(r => setTimeout(r, 600))
  assert.equal(done, false, 'harus menunggu kunci')
  release(); await holder; await pending
  assert.deepEqual(await state(id2), { total: 1_000_000, sum: 1_000_000, lines: 3 })
})
await t('EDIT CATATAN (Fase 8C + SEC-101): hanya `reason` yang berubah (label, jumlah, total, snapshot utuh) dan SIAPA + KAPAN tercatat; kosong menghapus; >500 → 400; milik pesanan lain / tak ada → 404; boleh walau pesanan tak lagi menunggu pembayaran', async () => {
  const id = await mkBooking()
  const r = await adjustBookingTotal({ bookingId: id, amountIdr: -100_000, label: 'Diskon rombongan', reason: 'awal', byUserId: staff.id })
  const snapBefore = await prisma.priceSnapshot.findMany({ where: { bookingId: id }, orderBy: { lineKey: 'asc' } })
  const created = (await listAdjustments(id))[0]!
  assert.deepEqual([created.reasonEditedByName, created.reasonEditedAt], [null, null], 'baru dibuat: belum pernah diedit')
  const before = Date.now()
  assert.deepEqual(await updateAdjustmentReason({ bookingId: id, adjustmentId: r.adjustmentId, reason: '  nego dengan Bpk. Ahmad  ', byUserId: staff2.id }), { id: r.adjustmentId, reason: 'nego dengan Bpk. Ahmad', changed: true })
  const row = (await listAdjustments(id))[0]!
  assert.deepEqual([row.label, row.amountIdr, row.totalBefore, row.totalAfter, row.reason, row.byUserId, row.reasonEditedByName], ['Diskon rombongan', -100_000, 1_500_000, 1_400_000, 'nego dengan Bpk. Ahmad', staff.id, 'Admin Dua'], 'pembuat tetap, editor tercatat terpisah')
  assert.ok(Date.parse(row.reasonEditedAt!) >= before - 1000 && Date.parse(row.reasonEditedAt!) <= Date.now() + 1000)
  assert.deepEqual(await prisma.priceSnapshot.findMany({ where: { bookingId: id }, orderBy: { lineKey: 'asc' } }), snapBefore, 'snapshot tak tersentuh')
  assert.deepEqual(await state(id), { total: 1_400_000, sum: 1_400_000, lines: 3 })
  // catatan yang sama (setelah trim) tidak menggeser jejak
  const same = await updateAdjustmentReason({ bookingId: id, adjustmentId: r.adjustmentId, reason: 'nego dengan Bpk. Ahmad ', byUserId: staff.id })
  assert.equal(same.changed, false)
  const after = (await listAdjustments(id))[0]!
  assert.deepEqual([after.reasonEditedByName, after.reasonEditedAt], [row.reasonEditedByName, row.reasonEditedAt], 'tak berubah → jejak tak bergeser')
  // kosong menghapus catatan dan tetap tercatat sebagai edit oleh pelakunya
  assert.deepEqual(await updateAdjustmentReason({ bookingId: id, adjustmentId: r.adjustmentId, reason: '   ', byUserId: staff.id }), { id: r.adjustmentId, reason: null, changed: true })
  assert.equal((await listAdjustments(id))[0]!.reasonEditedByName, 'Admin Uji')
  await rejectsAdj(() => updateAdjustmentReason({ bookingId: id, adjustmentId: r.adjustmentId, reason: 'x'.repeat(501), byUserId: staff.id }), 400, /maksimal 500/)
  const other = await mkBooking()
  await rejectsAdj(() => updateAdjustmentReason({ bookingId: other, adjustmentId: r.adjustmentId, reason: 'x', byUserId: staff.id }), 404, /tidak ditemukan/)
  await rejectsAdj(() => updateAdjustmentReason({ bookingId: id, adjustmentId: '00000000-0000-0000-0000-000000000000', reason: 'x', byUserId: staff.id }), 404, /tidak ditemukan/)
  await prisma.booking.update({ where: { id }, data: legacyBookingState('confirmed') })
  assert.equal((await updateAdjustmentReason({ bookingId: id, adjustmentId: r.adjustmentId, reason: 'dicatat ulang setelah lunas', byUserId: staff.id })).reason, 'dicatat ulang setelah lunas')
})
await t('EDIT CATATAN: dua editor bersamaan → keduanya berhasil berurutan, jejak = editor TERAKHIR yang benar-benar menulis (pasangan pelaku+waktu tak pernah campur); DB menolak pasangan tak lengkap', async () => {
  const id = await mkBooking()
  const r = await adjustBookingTotal({ bookingId: id, amountIdr: -100_000, label: 'D', reason: 'awal', byUserId: staff.id })
  const res = await Promise.allSettled([
    updateAdjustmentReason({ bookingId: id, adjustmentId: r.adjustmentId, reason: 'versi A', byUserId: staff.id }),
    updateAdjustmentReason({ bookingId: id, adjustmentId: r.adjustmentId, reason: 'versi B', byUserId: staff2.id }),
  ])
  assert.ok(res.every(x => x.status === 'fulfilled'))
  const row = await prisma.bookingAdjustment.findUniqueOrThrow({ where: { id: r.adjustmentId } })
  assert.ok((row.reason === 'versi A' && row.reasonEditedByUserId === staff.id) || (row.reason === 'versi B' && row.reasonEditedByUserId === staff2.id), `jejak harus milik penulis terakhir: ${row.reason}/${row.reasonEditedByUserId}`)
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE booking_adjustments SET "reasonEditedByUserId" = NULL WHERE id = '${r.adjustmentId}'`), /reason_edit_paired|check/i)
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE booking_adjustments SET "reasonEditedAt" = NULL WHERE id = '${r.adjustmentId}'`), /reason_edit_paired|check/i)
})
await t('I5 (Fase 8): angka internal (HPP/rekomendasi/peringatan) hanya di jalur admin — tak ada di API jamaah, halaman jamaah, invoice, notifikasi, maupun skema respons publik', () => {
  const walk = (dir: string, out: string[] = []): string[] => { for (const f of readdirSync(dir)) { if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue; const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p) } return out }
  const internal = /bookingPriceSummary|evaluatePricing|lib\/pricing\/warnings|recommendedTotalIdr|warningAfter|warningBefore|costKnownIdr/
  const publicFiles = [
    ...walk(join(root, 'app/api/v1/bookings')), ...walk(join(root, 'app/[locale]/(pilgrim)')), ...walk(join(root, 'app/[locale]/(public)')),
    ...walk(join(root, 'lib/pdf')), ...walk(join(root, 'lib/notifications')), ...walk(join(root, 'lib/validators')).filter(f => !/adjustments\.ts$/.test(f)),
  ]
  assert.deepEqual(publicFiles.filter(f => internal.test(readFileSync(f, 'utf8'))).map(f => f.slice(root.length)), [])
})
await t('PENJAGA: route penyesuaian dijaga policy di awal; konfirmasi bayar memakai resolveConfirmedAmount + skema .strict(); hanya lib/booking/adjustments.ts (+ pembersihan UU PDP) menulis booking_adjustments; catatan internal tak ada di invoice', () => {
  for (const f of ['app/api/v1/admin/bookings/[id]/adjustments/route.ts', 'app/api/v1/admin/bookings/[id]/adjustments/[adjId]/reverse/route.ts', 'app/api/v1/admin/bookings/[id]/adjustments/[adjId]/route.ts', 'app/api/v1/admin/bookings/[id]/total/route.ts', 'app/api/v1/admin/bookings/[id]/pricing/route.ts']) {
    const src = read(f)
    assert.match(src, /requireBookingAdjust\(\)|requirePricingView\(\)/, f); assert.doesNotMatch(src, /requireManager|requireSuperAdmin|requireAdmin\(/, f)
    assert.doesNotMatch(src, /priceSnapshot|bookingAdjustment/, `${f}: route tak menyentuh tabel langsung`)
  }
  const confirm = read('app/api/v1/admin/payments/[id]/confirm/route.ts')
  assert.match(confirm, /processPayment\(/); assert.match(confirm, /\.strict\(\)/)
  const proc = read('lib/payments/process.ts')
  assert.match(proc, /FOR UPDATE/); assert.match(proc, /resolveConfirmedAmount\(/); assert.match(proc, /payment\.status !== 'pending' \|\| booking\.status !== 'active' \|\| booking\.confirmedAt !== null/)
  assert.doesNotMatch(read('app/api/v1/bookings/[id]/route.ts'), /payments:\s*\{ orderBy: \{ createdAt: 'desc' \}, take: 1 \}/, 'catatan staf pembayaran tak boleh ikut ke jamaah')
  const walk = (dir: string, out: string[] = []): string[] => { for (const f of readdirSync(dir)) { if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue; const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p) } return out }
  const writers = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'components'))].filter(f => /bookingAdjustment\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\b/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(writers.map(f => f.slice(root.length)).sort(), ['lib/account/deletion.ts', 'lib/booking/adjustments.ts'], 'penulis: modul ini + pembersihan catatan staf saat hapus akun (UU PDP)')
  assert.doesNotMatch(read('lib/pdf/invoiceData.ts'), /bookingAdjustment|reason/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.payment.deleteMany({ where: { bookingId: { in: bookings } } })
await prisma.booking.deleteMany({ where: { id: { in: bookings } } }) // cascade: snapshot + penyesuaian
await prisma.user.deleteMany({ where: { id: { in: [user.id, staff.id, staff2.id] } } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
