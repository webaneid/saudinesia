// Fase 6 harga terpadu (docs/arsitektur-harga-terpadu.md §19): laporan untung dari snapshot terhadap DATABASE SUNGGUHAN, dengan angka yang dihitung TANGAN.
// Dibuktikan: batas periode menurut WIB, cakupan status (batal tak pernah masuk; menunggu bayar hanya bila diminta), untung hanya dari baris bermodal + cakupan modal,
// penyesuaian bermodal 0 (sisa data lama = modal tak diketahui), rasio terealisasi (dijepit 0..1; pembayaran pending/rejected tak dihitung; refund disetujui/dibayar mengurangi),
// irisan produk/vendor (satu vendor, beberapa, tak tercatat)/bulan, daftar booking berhalaman, penahanan dari pembatalan, validasi masukan, serta penjaga sumber (akses + I5).
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { getBookingProfitRows, getProfitReport, periodBounds, ReportInputError, type ReportParams } from '@/lib/reports/profit'
import { assertThrowawayDb } from './lib/testDb'
import { legacyBookingState, type LegacyBookingStatus } from './lib/legacyStatus'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `rp${Date.now()}`
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Laporan', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const v1 = await prisma.vendor.create({ data: { name: `${tag} vendor satu`, nameKey: `${tag} vendor satu`, countryCode: 'SA' } })
const v2 = await prisma.vendor.create({ data: { name: `${tag} vendor dua`, nameKey: `${tag} vendor dua`, countryCode: 'SA' } })
const bookings: string[] = []

type Line = { itemType: string; lineKey?: string; label?: string; sell: number; cost: number | null; vendors?: string[] }
type Pay = { amount: number; status: 'pending' | 'confirmed' | 'rejected' }
type Ref = { amount: number; status: 'pending' | 'approved' | 'paid' | 'rejected' }
let n = 0
async function mk(code: string, at: string, status: LegacyBookingStatus, lines: Line[], pays: Pay[] = [], refs: Ref[] = []) {
  const total = lines.reduce((s, l) => s + l.sell, 0)
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${code}`, userId: user.id, ...legacyBookingState(status), departureDate: new Date('2091-01-01'), returnDate: new Date('2091-01-10'), season: 'regular', totalAmount: total, createdAt: new Date(at) } })
  bookings.push(b.id)
  for (const l of lines) {
    await prisma.priceSnapshot.create({ data: {
      bookingId: b.id, itemType: l.itemType, itemId: `${b.id}-${++n}`, lineKey: l.lineKey ?? 'main', itemLabel: l.label ?? l.itemType, itemQty: 1, description: l.label ?? l.itemType, qty: 1, unit: 'item',
      unitSellIdr: l.sell, totalSellIdr: l.sell, unitCostIdr: l.cost, totalCostIdr: l.cost, mode: 'auto', vendorIds: l.vendors ?? [],
    } })
  }
  for (const p of pays) await prisma.payment.create({ data: { bookingId: b.id, amount: p.amount, method: 'transfer', status: p.status, confirmedAt: p.status === 'confirmed' ? new Date(at) : null } })
  for (const r of refs) await prisma.refund.create({ data: { bookingId: b.id, amount: r.amount, reason: 'uji', status: r.status } })
  return b.id
}

// ── dunia uji (semua tahun 2090 — tak bertabrakan dengan data lain; tanggal dalam UTC, WIB = UTC+7) ───────────────────────────────────────────────
await mk('B1', '2090-03-10T05:00:00Z', 'confirmed', [{ itemType: 'hotel', sell: 7_200_000, cost: 6_000_000, vendors: [v1.id] }], [{ amount: 7_200_000, status: 'confirmed' }])
await mk('B2', '2090-03-31T18:00:00Z', 'completed', [ // 1 April 01:00 WIB → BULAN APRIL
  { itemType: 'visa', sell: 2_000_000, cost: 1_500_000, vendors: [v1.id, v2.id] }, { itemType: 'catering', sell: 600_000, cost: null }], [{ amount: 1_300_000, status: 'confirmed' }])
await mk('B3', '2090-03-20T03:00:00Z', 'confirmed', [
  { itemType: 'tourPackage', lineKey: 'komponen:x', sell: 1_200_000, cost: 1_000_000, vendors: [v2.id] }, { itemType: 'tourPackage', lineKey: 'penyesuaian', sell: -200_000, cost: null }],
  [{ amount: 1_000_000, status: 'confirmed' }], [{ amount: 250_000, status: 'approved' }, { amount: 100_000, status: 'pending' }, { amount: 50_000, status: 'rejected' }]) // pending/rejected tak mengurangi
await mk('B4', '2090-03-22T03:00:00Z', 'awaiting_payment', [{ itemType: 'transport', sell: 500_000, cost: 400_000, vendors: [v1.id] }])
await mk('B5', '2090-03-12T03:00:00Z', 'cancelled', [{ itemType: 'hotel', sell: 3_000_000, cost: 2_000_000, vendors: [v1.id] }], [{ amount: 3_000_000, status: 'confirmed' }], [{ amount: 2_400_000, status: 'paid' }])
await mk('B6', '2090-03-25T03:00:00Z', 'confirmed', [{ itemType: 'booking', lineKey: 'penyesuaian', label: 'Penyesuaian data lama', sell: 400_000, cost: null }])
await mk('B7', '2090-02-28T16:59:59Z', 'confirmed', [{ itemType: 'hotel', sell: 900_000, cost: 700_000, vendors: [v1.id] }]) // 28 Feb 23:59:59 WIB
await mk('B8', '2090-03-31T16:00:00Z', 'active', [{ itemType: 'transport', sell: 100_000, cost: 50_000, vendors: [v1.id] }], [{ amount: 100_000, status: 'pending' }, { amount: 100_000, status: 'rejected' }]) // 31 Mar 23:00 WIB
await mk('B9', '2090-05-10T03:00:00Z', 'confirmed', [{ itemType: 'hotel', sell: 1_000_000, cost: 800_000, vendors: [v1.id] }], [{ amount: 1_500_000, status: 'confirmed' }])          // dibayar berlebih → rasio dijepit 1
await mk('B10', '2090-05-11T03:00:00Z', 'confirmed', [{ itemType: 'hotel', sell: 1_000_000, cost: 800_000, vendors: [v1.id] }], [{ amount: 500_000, status: 'confirmed' }], [{ amount: 700_000, status: 'approved' }]) // refund > bayar → rasio dijepit 0

await mk('B11', '2090-06-10T03:00:00Z', 'confirmed', [{ itemType: 'hotel', sell: 700_000, cost: 800_000, vendors: [v1.id] }, { itemType: 'catering', sell: 300_000, cost: null }]) // di bawah HPP (diskon melampaui margin)
await mk('B12', '2090-06-11T03:00:00Z', 'confirmed', [{ itemType: 'hotel', sell: 900_000, cost: 800_000, vendors: [v1.id] }])

const mar: ReportParams = { from: '2090-03-01', to: '2090-03-31', scope: 'recognized' }

await t('MARET (diakui): ringkasan — penjualan, modal diketahui, jual tanpa modal, untung, margin, cakupan, terealisasi, uang masuk/keluar', async () => {
  const r = await getProfitReport(mar)
  // B1 + B3 + B6 + B8 (B2 = April, B4 menunggu bayar, B5 batal, B7 = Februari)
  assert.deepEqual(r.summary, {
    bookings: 4, paidIdr: 8_200_000, refundedIdr: 250_000, lossBookings: 0,
    sellIdr: 8_700_000, costKnownIdr: 7_050_000, sellUnknownCostIdr: 400_000, profitIdr: 1_250_000, marginPct: 15.1, costCoveragePct: 95.4,
    realizedSellIdr: 7_950_000, realizedProfitIdr: 1_200_000,
  })
})
await t('batas periode menurut WIB: 31 Mar 23:00 WIB masuk Maret; 1 Apr 01:00 WIB masuk April; 28 Feb 23:59:59 WIB masuk Februari', async () => {
  assert.equal((await getBookingProfitRows(mar, 1, 50)).rows.some(r => r.bookingCode.endsWith('-B8')), true)
  const apr = await getProfitReport({ from: '2090-04-01', to: '2090-04-30', scope: 'recognized' })
  assert.deepEqual([apr.summary.bookings, apr.summary.sellIdr], [1, 2_600_000])
  const feb = await getProfitReport({ from: '2090-02-28', to: '2090-02-28', scope: 'recognized' })
  assert.deepEqual([feb.summary.bookings, feb.summary.sellIdr, feb.summary.profitIdr], [1, 900_000, 200_000])
})
await t('APRIL: jual tanpa modal dilaporkan terpisah, untung hanya dari baris bermodal, terealisasi = rasio dibayar 50%', async () => {
  const r = await getProfitReport({ from: '2090-04-01', to: '2090-04-30', scope: 'recognized' })
  assert.deepEqual(r.summary, { bookings: 1, paidIdr: 1_300_000, refundedIdr: 0, lossBookings: 0, sellIdr: 2_600_000, costKnownIdr: 1_500_000, sellUnknownCostIdr: 600_000, profitIdr: 500_000, marginPct: 25, costCoveragePct: 76.9, realizedSellIdr: 1_300_000, realizedProfitIdr: 250_000 })
})
await t('cakupan: menunggu bayar hanya bila diminta; batal TIDAK pernah masuk penjualan/untung', async () => {
  const r = await getProfitReport({ ...mar, scope: 'with_pending' })
  assert.deepEqual([r.summary.bookings, r.summary.sellIdr, r.summary.costKnownIdr, r.summary.profitIdr], [5, 9_200_000, 7_450_000, 1_350_000])
  assert.ok(![...(await getBookingProfitRows({ ...mar, scope: 'with_pending' }, 1, 50)).rows].some(x => x.status === 'cancelled'))
})
await t('pembatalan: uang ditahan = bayar terkonfirmasi − refund disetujui/dibayar (B5: 3.000.000 − 2.400.000 = 600.000), dilaporkan terpisah', async () => {
  const r = await getProfitReport(mar)
  assert.deepEqual(r.cancelledRetained, { bookings: 1, retainedIdr: 600_000 })
})
await t('irisan produk: baris penyesuaian bermodal 0 (untung komposit = 0), sisa data lama = modal tak diketahui', async () => {
  const r = await getProfitReport(mar)
  assert.deepEqual(r.byProduct.map(x => [x.itemType, x.sellIdr, x.costKnownIdr, x.sellUnknownCostIdr, x.profitIdr]), [
    ['hotel', 7_200_000, 6_000_000, 0, 1_200_000], ['tourPackage', 1_000_000, 1_000_000, 0, 0], ['booking', 400_000, 0, 400_000, 0], ['transport', 100_000, 50_000, 0, 50_000],
  ])
})
await t('irisan vendor: satu vendor → vendor itu; beberapa → "campuran"; tanpa jejak → "tak tercatat" (tanpa pembagian rata)', async () => {
  const r = await getProfitReport(mar)
  assert.deepEqual(r.byVendor.map(x => [x.kind, x.label, x.sellIdr, x.costKnownIdr, x.sellUnknownCostIdr]), [
    ['vendor', v1.name, 7_300_000, 6_050_000, 0], ['vendor', v2.name, 1_200_000, 1_000_000, 0], ['none', 'Vendor tak tercatat', 200_000, 0, 400_000],
  ])
  const apr = await getProfitReport({ from: '2090-04-01', to: '2090-04-30', scope: 'recognized' })
  assert.deepEqual(apr.byVendor.map(x => [x.kind, x.sellIdr, x.costKnownIdr]), [['multi', 2_000_000, 1_500_000], ['none', 600_000, 0]])
})
await t('irisan bulan (WIB) dan rentang beberapa bulan', async () => {
  const r = await getProfitReport({ from: '2090-02-01', to: '2090-05-31', scope: 'recognized' })
  assert.deepEqual(r.byMonth.map(x => [x.month, x.sellIdr, x.profitIdr]), [['2090-02', 900_000, 200_000], ['2090-03', 8_700_000, 1_250_000], ['2090-04', 2_600_000, 500_000], ['2090-05', 2_000_000, 400_000]])
})
await t('rasio terealisasi dijepit 0..1: dibayar berlebih → 1; refund lebih besar dari bayar → 0; pembayaran pending/rejected tak dihitung', async () => {
  const may = await getProfitReport({ from: '2090-05-01', to: '2090-05-31', scope: 'recognized' })
  assert.deepEqual([may.summary.realizedSellIdr, may.summary.realizedProfitIdr], [1_000_000, 200_000])
  const rows = (await getBookingProfitRows(mar, 1, 50)).rows
  assert.equal(rows.find(r => r.bookingCode.endsWith('-B8'))!.realizedRatio, 0, 'hanya pending/rejected → belum terealisasi')
})
await t('PESANAN DI BAWAH HPP (7D): dihitung di ringkasan dan dapat disaring; untung teridentifikasi negatif; jual tanpa modal tak menutupi kerugian', async () => {
  const jun: ReportParams = { from: '2090-06-01', to: '2090-06-30', scope: 'recognized' }
  const r = await getProfitReport(jun)
  assert.deepEqual([r.summary.bookings, r.summary.lossBookings, r.summary.profitIdr, r.summary.sellUnknownCostIdr], [2, 1, 0, 300_000]) // −100.000 (B11) + 100.000 (B12)
  const only = await getBookingProfitRows(jun, 1, 50, true)
  assert.deepEqual([only.total, only.rows.map(x => x.bookingCode.slice(tag.length + 1)), only.rows[0]!.profitIdr], [1, ['B11'], -100_000])
  assert.equal((await getBookingProfitRows(jun, 1, 50)).total, 2)
  assert.equal((await getProfitReport(mar)).summary.lossBookings, 0)
})
await t('daftar booking: terbaru dulu, angka per booking benar, berhalaman (total tetap)', async () => {
  const p1 = await getBookingProfitRows(mar, 1, 2), p2 = await getBookingProfitRows(mar, 2, 2)
  assert.deepEqual([p1.total, p2.total], [4, 4])
  assert.deepEqual([...p1.rows, ...p2.rows].map(r => r.bookingCode.slice(tag.length + 1)), ['B8', 'B6', 'B3', 'B1'])
  const b3 = p2.rows.find(r => r.bookingCode.endsWith('-B3'))!
  assert.deepEqual([b3.totalIdr, b3.sellIdr, b3.costKnownIdr, b3.profitIdr, b3.paidIdr, b3.refundedIdr, b3.realizedRatio, b3.realizedProfitIdr, b3.realizedSellIdr], [1_000_000, 1_000_000, 1_000_000, 0, 1_000_000, 250_000, 0.75, 0, 750_000])
  const b6 = p1.rows.find(r => r.bookingCode.endsWith('-B6'))!
  assert.deepEqual([b6.sellUnknownCostIdr, b6.profitIdr, b6.marginPct, b6.costCoveragePct], [400_000, 0, null, 0])
})
await t('masukan: format/urutan/rentang tanggal salah → ReportInputError; halaman/batas liar ditolak; periode kosong → angka nol (bukan galat)', async () => {
  for (const [f, tt] of [['2090-3-1', '2090-03-31'], ['2090-03-31', '2090-03-01'], ['2090-02-30', '2090-03-01'], ['1990-01-01', '2090-01-01']] as const) {
    assert.throws(() => periodBounds(f, tt), (e: unknown) => e instanceof ReportInputError, `${f}..${tt}`)
  }
  await assert.rejects(() => getBookingProfitRows(mar, 0, 10), (e: unknown) => e instanceof ReportInputError)
  await assert.rejects(() => getBookingProfitRows(mar, 1, 10_001), (e: unknown) => e instanceof ReportInputError)
  const empty = await getProfitReport({ from: '2090-08-01', to: '2090-08-31', scope: 'with_pending' })
  assert.deepEqual([empty.summary.bookings, empty.summary.sellIdr, empty.summary.marginPct, empty.summary.costCoveragePct, empty.byProduct.length, empty.cancelledRetained.retainedIdr], [0, 0, null, null, 0, 0])
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
const read = (f: string) => readFileSync(join(new URL('..', import.meta.url).pathname, f), 'utf8')
await t('PENJAGA: route laporan dijaga policy harga di awal (bukan peran sendiri); halaman memuat data lewat API itu; SQL mentah hanya ber-parameter (tanpa $queryRawUnsafe)', () => {
  for (const f of ['app/api/v1/admin/reports/profit/route.ts', 'app/api/v1/admin/reports/profit/export/route.ts']) {
    const src = read(f)
    const guard = src.indexOf('await requirePricingView()')
    assert.ok(guard > 0, `${f}: policy harga wajib`)
    for (const call of ['getProfitReport(', 'getBookingProfitRows(']) if (src.includes(call)) assert.ok(src.indexOf(call, src.indexOf('export async function GET')) > guard, `${f}: ${call} dipanggil sebelum pemeriksaan peran`)
    assert.doesNotMatch(src, /requireManager|requireSuperAdmin|requireAdmin\(/, `${f}: peran harga hanya lewat policy`)
    assert.match(src, /authFailureResponse|ReportInputError/, f)
  }
  const lib = read('lib/reports/profit.ts')
  assert.doesNotMatch(lib, /\$queryRawUnsafe|\$executeRaw/); assert.match(lib, /Prisma\.sql`/)
  assert.match(read('app/[locale]/admin/(protected)/reports/page.tsx'), /\/api\/v1\/admin\/reports\/profit/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.refund.deleteMany({ where: { bookingId: { in: bookings } } })
await prisma.payment.deleteMany({ where: { bookingId: { in: bookings } } })
await prisma.booking.deleteMany({ where: { id: { in: bookings } } }) // cascade: snapshot
await prisma.user.delete({ where: { id: user.id } })
await prisma.vendor.deleteMany({ where: { id: { in: [v1.id, v2.id] } } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
