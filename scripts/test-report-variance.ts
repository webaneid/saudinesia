// Fase 7 harga terpadu (docs/arsitektur-harga-terpadu.md §20, 7D): laporan Selisih HPP vs Aktual terhadap DATABASE SUNGGUHAN, angka dihitung TANGAN.
// Dibuktikan: selisih hanya dari baris LUNAS (belum lunas dilaporkan terpisah), pengeluaran dibatalkan tak dihitung, belanja tanpa rencana (modal tak diketahui / tanpa rujukan baris) terpisah,
// semua status pesanan ikut (uang keluar tetap biaya), periode menurut WIB, irisan produk/bulan/vendor/komponen, urutan + penyaring selisih, serta penjaga akses.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { getVarianceLines, getVarianceReport } from '@/lib/reports/variance'
import { assertThrowawayDb } from './lib/testDb'
import { legacyBookingState, type LegacyBookingStatus } from './lib/legacyStatus'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `rv${Date.now()}`
const owner = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Pemesan', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const mkVendor = (name: string) => prisma.vendor.create({ data: { name: `${tag} ${name}`, nameKey: `${tag} ${name}`.toLowerCase(), countryCode: 'SA' } })
const v1 = await mkVendor('satu'), v2 = await mkVendor('dua')
const bookings: string[] = []
let n = 0

async function mkBooking(code: string, at: string, status: LegacyBookingStatus, lines: Array<{ key: string; type: string; plan: number | null; label: string }>) {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${code}`, userId: owner.id, ...legacyBookingState(status), departureDate: new Date('2091-01-01'), returnDate: new Date('2091-01-10'), season: 'regular', totalAmount: lines.length * 1_000_000, createdAt: new Date(at) } })
  bookings.push(b.id)
  const ids: Record<string, string> = {}
  for (const l of lines) {
    ids[l.key] = (await prisma.priceSnapshot.create({ data: { bookingId: b.id, itemType: l.type, itemId: `${b.id}-${l.key}`, itemLabel: l.type, itemQty: 1, description: l.label, qty: 1, unit: 'item', unitSellIdr: 1_000_000, totalSellIdr: 1_000_000, unitCostIdr: l.plan, totalCostIdr: l.plan, mode: 'auto' } })).id
  }
  return { id: b.id, ids }
}
const spend = async (bookingId: string, snapshotId: string | null, amountIdr: number, o: { vendor?: string; component?: string; settled?: boolean; note?: string; void?: boolean } = {}) =>
  prisma.costActual.create({ data: {
    bookingId, snapshotId, vendorId: o.vendor ?? v1.id, component: o.component ?? 'kamar', currency: 'IDR', amount: amountIdr, amountIdr, paidAt: new Date('2026-03-10'), isSettled: o.settled ?? false,
    varianceNote: o.note ?? null, recordedBy: 'staf', ...(o.void ? { voidedAt: new Date(), voidedBy: 'staf', voidReason: 'salah input' } : {}),
  } })

// ── dunia uji (Maret 2090; WIB = UTC+7) ───────────────────────────────────────────────────────────────────────────────
const V1 = await mkBooking('V1', '2090-03-10T05:00:00Z', 'confirmed', [
  { key: 'hotel', type: 'hotel', plan: 6_000_000, label: 'Hotel kamar' }, { key: 'visa', type: 'visa', plan: 1_500_000, label: 'Visa individu' }, { key: 'cat', type: 'catering', plan: null, label: 'Katering' }])
await spend(V1.id, V1.ids.hotel!, 6_500_000, { settled: true, note: 'kurs SAR naik saat pelunasan' })
await spend(V1.id, V1.ids.hotel!, 999_000, { void: true })                                  // dibatalkan → tak dihitung
await spend(V1.id, V1.ids.visa!, 1_500_000, { settled: true, component: 'visa' })
await spend(V1.id, V1.ids.cat!, 700_000, { vendor: v2.id, component: 'katering', settled: true }) // rencana tak diketahui → belanja tanpa rencana
await spend(V1.id, null, 100_000, { vendor: v2.id, component: 'lain' })                      // tanpa rujukan baris
const V2 = await mkBooking('V2', '2090-03-12T03:00:00Z', 'cancelled', [{ key: 'hotel', type: 'hotel', plan: 2_000_000, label: 'Hotel batal' }])
await spend(V2.id, V2.ids.hotel!, 1_000_000)                                                // belum lunas: terbayar sejauh ini
const V3 = await mkBooking('V3', '2090-03-31T18:00:00Z', 'confirmed', [{ key: 'hotel', type: 'hotel', plan: 3_000_000, label: 'Hotel April' }]) // 1 April 01:00 WIB
await spend(V3.id, V3.ids.hotel!, 2_500_000, { settled: true, note: 'hemat negosiasi' })

const mar = { from: '2090-03-01', to: '2090-03-31' }

await t('MARET: ringkasan — selisih hanya dari baris LUNAS (hotel +500.000, visa 0), baris belum lunas terpisah, belanja tanpa rencana, total belanja (batal & April tak ikut)', async () => {
  const r = await getVarianceReport(mar)
  assert.deepEqual(r.summary, {
    settled: { lines: 2, planIdr: 7_500_000, actualIdr: 8_000_000, varianceIdr: 500_000, overrunLines: 1, savingLines: 0, onPlanLines: 1 },
    partial: { lines: 1, planIdr: 2_000_000, paidIdr: 1_000_000 },
    spendWithoutPlanIdr: 800_000, totalSpendIdr: 9_800_000,
  })
})
await t('irisan produk (hanya baris lunas) dan bulan WIB; April terpisah (31 Mar 18:00 UTC = 1 April WIB)', async () => {
  const r = await getVarianceReport(mar)
  assert.deepEqual(r.byProduct.map(x => [x.itemType, x.lines, x.planIdr, x.actualIdr, x.varianceIdr]), [['hotel', 1, 6_000_000, 6_500_000, 500_000], ['visa', 1, 1_500_000, 1_500_000, 0]])
  assert.deepEqual(r.byMonth.map(x => [x.month, x.varianceIdr]), [['2090-03', 500_000]])
  const wide = await getVarianceReport({ from: '2090-03-01', to: '2090-04-30' })
  assert.deepEqual(wide.byMonth.map(x => [x.month, x.planIdr, x.actualIdr, x.varianceIdr]), [['2090-03', 7_500_000, 8_000_000, 500_000], ['2090-04', 3_000_000, 2_500_000, -500_000]])
  const apr = await getVarianceReport({ from: '2090-04-01', to: '2090-04-30' })
  assert.deepEqual([apr.summary.settled.lines, apr.summary.settled.savingLines, apr.summary.settled.varianceIdr], [1, 1, -500_000])
})
await t('belanja per vendor yang DIBAYAR dan per komponen (void tak dihitung)', async () => {
  const r = await getVarianceReport(mar)
  assert.deepEqual(r.spendByVendor.map(x => [x.label, x.spendIdr, x.entries]), [[`${tag} satu`, 9_000_000, 3], [`${tag} dua`, 800_000, 2]])
  assert.deepEqual(r.spendByComponent.map(x => [x.component, x.spendIdr]), [['kamar', 7_500_000], ['visa', 1_500_000], ['katering', 700_000], ['lain', 100_000]])
})
await t('daftar baris rencana: selisih mutlak terbesar dulu; catatan ikut; penyaring "hanya selisih" = baris LUNAS yang melenceng; halaman', async () => {
  const all = await getVarianceLines(mar, 1, 50)
  assert.deepEqual(all.rows.map(x => [x.description, x.planIdr, x.actualIdr, x.varianceIdr, x.settled]), [
    ['Hotel batal', 2_000_000, 1_000_000, -1_000_000, false], ['Hotel kamar', 6_000_000, 6_500_000, 500_000, true], ['Visa individu', 1_500_000, 1_500_000, 0, true],
  ])
  assert.equal(all.rows[1]!.notes, 'kurs SAR naik saat pelunasan'); assert.equal(all.total, 3)
  const only = await getVarianceLines(mar, 1, 50, true)
  assert.deepEqual(only.rows.map(x => x.description), ['Hotel kamar']); assert.equal(only.total, 1)
  const p2 = await getVarianceLines(mar, 2, 2)
  assert.deepEqual([p2.rows.length, p2.total], [1, 3])
})
await t('periode kosong → angka nol; tanggal salah → ReportInputError', async () => {
  const r = await getVarianceReport({ from: '2090-08-01', to: '2090-08-31' })
  assert.deepEqual([r.summary.settled.lines, r.summary.totalSpendIdr, r.byProduct.length, r.spendByVendor.length], [0, 0, 0, 0])
  await assert.rejects(() => getVarianceReport({ from: '2090-13-01', to: '2090-12-31' }), /Tanggal/)
})

const read = (f: string) => readFileSync(join(new URL('..', import.meta.url).pathname, f), 'utf8')
await t('PENJAGA: route selisih dijaga policy harga di awal; SQL hanya Prisma.sql (tanpa Unsafe)', () => {
  const src = read('app/api/v1/admin/reports/cost-variance/route.ts')
  const guard = src.indexOf('await requirePricingView()')
  assert.ok(guard > 0 && src.indexOf('getVarianceReport(', guard) > guard)
  assert.doesNotMatch(src, /requireManager|requireSuperAdmin|requireAdmin\(/)
  assert.doesNotMatch(read('lib/reports/variance.ts'), /\$queryRawUnsafe|\$executeRaw/)
})

await prisma.costActual.deleteMany({ where: { bookingId: { in: bookings } } })
await prisma.booking.deleteMany({ where: { id: { in: bookings } } })
await prisma.user.delete({ where: { id: owner.id } })
await prisma.vendor.deleteMany({ where: { id: { in: [v1.id, v2.id] } } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
