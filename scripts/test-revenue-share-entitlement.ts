// Fase 13c bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md §5c) terhadap DATABASE SUNGGUHAN, lewat jalur uang yang sesungguhnya.
// Dibuktikan: hak hanya dari pembayaran terverifikasi, sebanding terbayar ÷ tagihan, tak pernah melebihi potensi (kelebihan bayar tak menambah); atur total
// (revisi invoice) merekonsiliasi; refund dibayar menurunkan hak; booking tanpa aturan beku tak menulis apa pun; tabel append-only + CHECK; idempoten;
// penjaga sumber (penulis tunggal, pemicu di empat jalur, tampilan hanya superadmin).
//
// PENGAMAN: menulis data sementara → hanya database sekali pakai.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { createDraft, publishDraft, saveDraft } from '@/lib/booking/drafts'
import type { BookingDraft } from '@/lib/validators/booking'
import { processPayment } from '@/lib/payments/process'
import { setBookingTotal } from '@/lib/booking/adjustments'
import { cancelByAdmin } from '@/lib/booking/adminCancel'
import { approveRefund, payRefund } from '@/lib/refunds/service'
import { ensurePricesFollowRevenueShare } from '@/lib/revenue-share/pricing'
import { saveRevenueShare, currentRevenueShare } from '@/lib/revenue-share/settings'
import { refreshAllPricingCaches } from '@/lib/pricing/refreshAll'
import { bookingShareStatus, entitlementTarget, syncRevenueShare } from '@/lib/revenue-share/entitlement'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name)
    if (statSync(join(root, rel)).isDirectory()) out.push(...files(rel))
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}
const tag = `rse${Date.now()}`

await t('TARGET (murni): potensi × rasio terbayar, dibatasi 0..potensi; tagihan 0 → 0', () => {
  assert.deepEqual(entitlementTarget(100_000, 1_250_000, 2_500_000), { ratio: 0.5, targetCents: 5_000_000 })
  assert.deepEqual(entitlementTarget(100_000, 3_000_000, 2_500_000), { ratio: 1, targetCents: 10_000_000 })
  assert.deepEqual(entitlementTarget(100_000, -5, 2_500_000), { ratio: 0, targetCents: 0 })
  assert.deepEqual(entitlementTarget(100_000, 10, 0), { ratio: 0, targetCents: 0 })
  assert.deepEqual(entitlementTarget(100_000, 1, 3), { ratio: 0.333333, targetCents: 3_333_333 }, '1/3 × 100.000 = 33.333,33 (rasio eksak; jejak 6 desimal)')
})

// ── dunia uji ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 1000 } })
const savedState = await prisma.revenueSharePricingState.findMany()
const savedTax = await prisma.taxRule.findMany({ where: { isActive: true }, select: { id: true } })
await prisma.taxRule.updateMany({ data: { isActive: false } }) // tagihan = subtotal, angka mudah dibaca
assert.equal(await prisma.user.count({ where: { isPlatformProvider: true } }), 0, 'DB uji tanpa akun Platform Provider')

// Pembersihan berdasarkan tag, SELALU dijalankan (finally): akun Platform Provider uji + penanda harga yang tertinggal membuat skrip uji lain gagal
// (FK Restrict entri hak ke booking) dan harga semua produk tetap ber-poin. Entri/kas/refund append-only → DB sekali pakai saja, trigger dimatikan di transaksi pembersih.
async function cleanup() {
  const bookings = (await prisma.booking.findMany({ where: { user: { email: { startsWith: `${tag}-` } } }, select: { id: true } })).map(b => b.id)
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.revenueShareEntry.deleteMany({ where: { bookingId: { in: bookings } } })
    await tx.cashEntry.deleteMany({ where: { bookingId: { in: bookings } } })
    await tx.refund.deleteMany({ where: { bookingId: { in: bookings } } })
    await tx.bookingCancellation.deleteMany({ where: { bookingId: { in: bookings } } })
  })
  await prisma.payment.deleteMany({ where: { bookingId: { in: bookings } } })
  await prisma.booking.deleteMany({ where: { id: { in: bookings } } })
  const routes = (await prisma.flightRoute.findMany({ where: { origin: { startsWith: tag } }, select: { id: true } })).map(r => r.id)
  await prisma.flightSchedule.deleteMany({ where: { routeId: { in: routes } } })
  await prisma.flightRoute.deleteMany({ where: { id: { in: routes } } })
  const vendors = (await prisma.vendor.findMany({ where: { nameKey: { startsWith: tag } }, select: { id: true } })).map(v => v.id)
  await prisma.productCost.deleteMany({ where: { vendorId: { in: vendors } } })
  await prisma.preferredVendor.deleteMany({ where: { vendorId: { in: vendors } } })
  await sweepOrphanPricePoints()
  await prisma.vendor.deleteMany({ where: { id: { in: vendors } } })
  const testUsers = (await prisma.user.findMany({ where: { email: { startsWith: `${tag}-` } }, select: { id: true } })).map(u => u.id)
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.revenueShareSetting.deleteMany({ where: { createdById: { in: testUsers } } })
  })
  await prisma.user.deleteMany({ where: { id: { in: testUsers } } })
  await prisma.revenueSharePricingState.deleteMany({})
  for (const st of savedState) await prisma.revenueSharePricingState.create({ data: st })
  for (const r of savedTax) await prisma.taxRule.update({ where: { id: r.id }, data: { isActive: true } })
  await prisma.pricingRule.deleteMany({})
  for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
  await refreshAllPricingCaches() // harga produk lain kembali tanpa poin uji
}

try {

const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
const customer = await prisma.user.create({ data: { email: `${tag}-c@example.test`, passwordHash: 'x', fullName: 'Pelanggan', role: 'pilgrim', isActive: true } })
const staff = await prisma.user.create({ data: { email: `${tag}-s@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'superadmin', isActive: true } })
const route = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: 'JED' } })
const flight = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 50 } })
await prisma.productCost.create({ data: { productType: 'flight', productId: flight.id, vendorId: vendor.id, costComponent: 'tiket', currency: 'IDR', costTiers: [{ minDays: 0, maxDays: 9999, cost: 1_000_000 }] as never } })
await prisma.preferredVendor.create({ data: { productType: 'flight', productId: flight.id, costComponent: 'tiket', vendorId: vendor.id } })
await repriceOwner('flight', flight.id)

const DRAFT: BookingDraft = { items: [{ itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-10', numPassengers: 2 }], pilgrims: [{}, {}], dueDays: 3 }
async function publish(): Promise<string> {
  const r = await createDraft(customer.id); assert.ok(r.ok)
  assert.ok((await saveDraft(r.id, DRAFT)).ok)
  const p = await publishDraft(r.id, { byUserId: staff.id }); assert.ok(p.ok, JSON.stringify(p))
  return r.id
}
async function pay(bookingId: string, amount: number): Promise<string> {
  const p = await prisma.payment.create({ data: { bookingId, amount: 0, claimedAmountIdr: amount, method: 'bank_transfer', status: 'pending' } })
  const r = await processPayment(p.id, { action: 'confirm', amount, notes: 'uji', cashAccount: { kind: 'cash' }, byUserId: staff.id })
  assert.equal(r.kind, 'done', JSON.stringify(r))
  return p.id
}
const entries = (bookingId: string) => prisma.revenueShareEntry.findMany({ where: { bookingId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
const sum = async (bookingId: string) => (await entries(bookingId)).reduce((s, e) => s + Math.round(Number(e.amountIdr) * 100), 0) / 100

await t('TANPA aturan beku (belum ada Platform Provider): pembayaran tak menulis hak; status tanpa persen', async () => {
  const b = await publish()
  await pay(b, 1_200_000)
  assert.equal((await entries(b)).length, 0)
  const s = await bookingShareStatus(prisma, b)
  assert.deepEqual([s.percent, s.potentialIdr, s.entitledIdr], [null, 0, 0])
})

const provider = await prisma.user.create({ data: { email: `${tag}-pp@example.test`, passwordHash: 'x', fullName: 'Provider', role: 'superadmin', isActive: true, isPlatformProvider: true } })
await ensurePricesFollowRevenueShare() // 5% markup diterapkan → harga 1.250.000/orang

let a = ''
await t('HAK dari pembayaran (P5): terbit = potensi 100.000, hak 0; bayar 50% → hak 50.000 (entri payment/id); lunas → 100.000; kelebihan bayar tak menambah', async () => {
  a = await publish()
  let s = await bookingShareStatus(prisma, a)
  assert.deepEqual([s.percent, s.basis, s.potentialIdr, s.entitledIdr, s.paidRatio], [5, 'markup', 100_000, 0, 0])
  const p1 = await pay(a, 1_250_000)
  const e1 = await entries(a)
  assert.deepEqual(e1.map(e => [e.source, e.refId, Number(e.amountIdr), Number(e.potentialIdr), Number(e.paidRatio), Number(e.entitledAfterIdr)]), [['payment', p1, 50_000, 100_000, 0.5, 50_000]])
  await pay(a, 1_250_000)
  assert.equal(await sum(a), 100_000)
  // kelebihan bayar: hak tetap; entri tak bertambah
  const n = (await entries(a)).length
  await pay(a, 100_000)
  assert.deepEqual([await sum(a), (await entries(a)).length], [100_000, n])
  s = await bookingShareStatus(prisma, a)
  assert.deepEqual([s.entitledIdr, s.paidRatio], [100_000, 1])
})

await t('IDEMPOTEN: sinkron ulang dengan penyebab yang sama tak menulis apa pun (tercatat = target)', async () => {
  const p = (await entries(a))[0]!
  const before = (await entries(a)).length
  assert.equal(await prisma.$transaction(tx => syncRevenueShare(tx, a, { source: 'payment', refId: p.refId })), 0)
  assert.equal((await entries(a)).length, before)
})

await t('REFUND dibayar menurunkan hak: batal dengan refund 1.250.000 dari 2.600.000 terbayar → hak 100.000 × 1.350.000 ÷ 2.500.000 = 54.000 (entri refund/id)', async () => {
  const c = await cancelByAdmin(a, { reason: 'uji batal', decision: 'refund', refundAmount: 1_250_000, note: 'uji', byUserId: staff.id, canMoney: true })
  assert.equal(c.kind, 'done', JSON.stringify(c))
  const refundId = c.kind === 'done' ? c.refundId : null
  assert.ok(refundId)
  assert.equal(await sum(a), 100_000, 'refund belum dibayar → hak belum berubah')
  assert.equal((await approveRefund(refundId!, staff.id, { isSuperadmin: false })).kind, 'done')
  assert.equal((await payRefund(refundId!, { byUserId: staff.id, cashAccount: { kind: 'cash' }, paidAt: new Date(), notes: null })).kind, 'done')
  const last = (await entries(a)).at(-1)!
  assert.deepEqual([last.source, last.refId, Number(last.amountIdr), Number(last.entitledAfterIdr)], ['refund', refundId, -46_000, 54_000])
  assert.equal(await sum(a), 54_000)
})

await t('ATUR TOTAL (revisi invoice) merekonsiliasi: bayar 1.000.000 dari 2.500.000 (hak 40.000) → diskon total ke 2.000.000 → rasio 0,5 → hak 50.000 (markup: diskon tak mengurangi potensi) (entri revision)', async () => {
  const b = await publish()
  await pay(b, 1_000_000)
  assert.equal(await sum(b), 40_000)
  const r = await setBookingTotal({ bookingId: b, totalIdr: 2_000_000, label: 'Diskon', reason: 'uji', byUserId: staff.id })
  assert.ok('kind' in r ? r.kind === 'done' || r.kind === 'ok' : true, JSON.stringify(r))
  const last = (await entries(b)).at(-1)!
  assert.equal(last.source, 'revision')
  assert.match(last.refId, new RegExp(`^${b}:r\\d+$`))
  assert.deepEqual([Number(last.potentialIdr), Number(last.paidRatio), await sum(b)], [100_000, 0.5, 50_000])
})

await t('DB: append-only (UPDATE/DELETE/TRUNCATE ditolak), CHECK (jumlah 0, hak > potensi, rasio > 1), UNIQUE (source, refId), booking dengan hak tak bisa dihapus', async () => {
  const e = (await entries(a))[0]!
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "revenue_share_entries" SET "amountIdr" = 1 WHERE "id" = $1`, e.id), /append-only/)
  await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM "revenue_share_entries" WHERE "id" = $1`, e.id), /append-only/)
  await assert.rejects(prisma.$transaction(async tx => { await tx.$executeRawUnsafe('TRUNCATE "revenue_share_entries"'); throw new Error('TRUNCATE lolos') }), /append-only/)
  const base = { bookingId: a, source: 'payment' as const, potentialIdr: 100, paidRatio: 0.5, entitledAfterIdr: 50 }
  await assert.rejects(prisma.revenueShareEntry.create({ data: { ...base, refId: `${tag}-x1`, amountIdr: 0 } }), /revenue_share_entries_shape/)
  await assert.rejects(prisma.revenueShareEntry.create({ data: { ...base, refId: `${tag}-x2`, amountIdr: 1, entitledAfterIdr: 101 } }), /revenue_share_entries_shape/)
  await assert.rejects(prisma.revenueShareEntry.create({ data: { ...base, refId: `${tag}-x3`, amountIdr: 1, paidRatio: 1.5 } }))
  await assert.rejects(prisma.revenueShareEntry.create({ data: { ...base, refId: e.refId, amountIdr: 1 } }), /Unique constraint/)
  await assert.rejects(prisma.booking.delete({ where: { id: a } }))
})

await t('CADANGAN refId (SEC-283): penyebab yang sama perlu koreksi lagi → akhiran = jumlah entri booking (selalu naik), dua kali berturut tak bertabrakan', async () => {
  const b = await publish()
  const p1 = await pay(b, 1_250_000)
  // uang masuk tanpa jalur pemicu (hanya uji) → tercatat ≠ target; sinkron dengan penyebab yang SUDAH ada
  await prisma.payment.create({ data: { bookingId: b, amount: 250_000, method: 'bank_transfer', status: 'confirmed', confirmedAt: new Date() } })
  const n = (await entries(b)).length
  assert.notEqual(await prisma.$transaction(tx => syncRevenueShare(tx, b, { source: 'payment', refId: p1 })), 0)
  await prisma.payment.create({ data: { bookingId: b, amount: 250_000, method: 'bank_transfer', status: 'confirmed', confirmedAt: new Date() } })
  assert.notEqual(await prisma.$transaction(tx => syncRevenueShare(tx, b, { source: 'payment', refId: p1 })), 0)
  const refs = (await entries(b)).map(e => e.refId)
  assert.deepEqual(refs, [p1, `${p1}#${n}`, `${p1}#${n + 1}`])
  assert.equal(await sum(b), 70_000, '1.750.000 ÷ 2.500.000 × 100.000')
})

await t('DASAR MARGIN + ENTRI NEGATIF: margin 5% → harga 1.200.000, potensi 5% × (2.400.000 − 2.000.000) = 20.000; bayar 1.200.000 → 10.000; diskon total ke 2.200.000 → potensi 10.000 × 1.200.000 ÷ 2.200.000 = 5.454,55 (entri revisi −4.545,45)', async () => {
  const c = await currentRevenueShare()
  await saveRevenueShare({ percent: 5, basis: 'margin', note: null, expectedId: c.id }, provider.id)
  await ensurePricesFollowRevenueShare()
  const b = await publish()
  await pay(b, 1_200_000)
  assert.equal(await sum(b), 10_000)
  await setBookingTotal({ bookingId: b, totalIdr: 2_200_000, label: 'Diskon', reason: 'uji', byUserId: staff.id })
  const last = (await entries(b)).at(-1)!
  assert.deepEqual([last.source, Number(last.amountIdr), Number(last.potentialIdr), Number(last.entitledAfterIdr)], ['revision', -4_545.45, 10_000, 5_454.55])
})

await t('BESAR (SEC-284): potensi Rp 2 miliar × terbayar ÷ tagihan triliunan tetap eksak sampai sen (BigInt), tak pernah melebihi potensi', () => {
  assert.equal(entitlementTarget(2_000_000_000, 1_000_000_000_001, 3_000_000_000_000).targetCents, 66_666_666_667)
  assert.equal(entitlementTarget(2_000_000_000, 4_000_000_000_000, 3_000_000_000_000).targetCents, 200_000_000_000)
})

const SRC = [...files('app'), ...files('components'), ...files('lib')]
await t('PENJAGA: penulis tunggal revenue_share_entries; sinkron di empat jalur uang/tagihan + Tandai selesai/Buka kembali (13d); kotak hanya superadmin; entri tanpa teks bebas', () => {
  assert.deepEqual(SRC.filter(f => /revenueShareEntry\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+"?revenue_share_entries/.test(read(f))), ['lib/revenue-share/entitlement.ts'])
  assert.deepEqual(SRC.filter(f => /await syncRevenueShare\(tx/.test(read(f))).sort(), ['lib/booking/completion.ts', 'lib/invoice/issue.ts', 'lib/payments/gateway.ts', 'lib/payments/process.ts', 'lib/refunds/service.ts'])
  assert.match(read('lib/payments/process.ts'), /postEntries\([\s\S]*?\n\s*await syncRevenueShare\(tx, booking\.id, \{ source: 'payment', refId: payment\.id \}\)/)
  assert.match(read('lib/payments/gateway.ts'), /await syncRevenueShare\(tx, booking\.id, \{ source: 'payment', refId: p\.id \}\)/)
  assert.match(read('lib/refunds/service.ts'), /await syncRevenueShare\(tx, r\.bookingId, \{ source: 'refund', refId: r\.id \}\)/)
  assert.match(read('lib/invoice/issue.ts'), /export async function reviseInvoice[\s\S]*?syncRevenueShare\(tx, bookingId, \{ source: 'revision'/)
  assert.match(read('app/[locale]/admin/(protected)/bookings/[id]/page.tsx'), /SUPERADMIN_ROLES\.includes\(session\.role\) && <RevenueShareBox/)
  const model = read('prisma/schema.prisma').split('model RevenueShareEntry {')[1]?.split('\n}')[0] ?? ''
  assert.doesNotMatch(model, /\b(note|reason|label|description|name)\b/i, 'entri tanpa teks bebas / PII')
})

} finally {
  await cleanup()
}
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
