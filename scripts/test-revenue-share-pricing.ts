// Fase 13b bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md) terhadap DATABASE SUNGGUHAN.
// Dibuktikan: tanpa akun Platform Provider aktif tak ada bagi hasil (harga & invoice tak tersentuh); opsi markup menambah poin ke margin di SATU tempat
// (resolveMarginRule) dan hitung ulang harga lewat satu pintu (penanda aturan diterapkan); opsi margin tak mengubah harga; aturan BEKU di invoice saat terbit
// (setelan berikutnya tak mengubah invoice lama); yang dibekukan = aturan yang SUDAH DITERAPKAN ke harga, bukan setelan terbaru (SEC-279); potensi per booking dari
// aturan beku + snapshot berlaku (angka pemilik P3); CHECK bentuk invoice; penjaga sumber.
//
// PENGAMAN: menulis data sementara → hanya database sekali pakai.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY, resolveMarginRule } from '@/lib/pricing/pricingHelpers'
import { createDraft, publishDraft, saveDraft } from '@/lib/booking/drafts'
import type { BookingDraft } from '@/lib/validators/booking'
import { currentRevenueShare, effectiveRevenueShare, revenueShareForIssue, revenueShareRuleKey, saveRevenueShare } from '@/lib/revenue-share/settings'
import { bookingSharePotential, lineShareCents, sharePotential } from '@/lib/revenue-share/potential'
import { ensurePricesFollowRevenueShare } from '@/lib/revenue-share/pricing'
import { refreshAllPricingCaches } from '@/lib/pricing/refreshAll'

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
const tag = `rsp${Date.now()}`

// ── murni: angka pemilik P3 ─────────────────────────────────────────────────────────────────────────────────────────────
await t('POTENSI per baris (angka pemilik): markup 5% × modal 1.000.000 = 50.000 (diskon tak mengurangi); margin 5% × (1.200.000 − 1.000.000) = 10.000, diskon −100.000 → −5.000; baris tanpa modal = 0; total tak negatif', () => {
  const item = { itemType: 'flight', lineKey: 'main', totalCostIdr: 1_000_000, totalSellIdr: 1_250_000 }
  const disc = { itemType: 'booking', lineKey: 'penyesuaian', totalCostIdr: null, totalSellIdr: -100_000 }
  const noCost = { itemType: 'catering', lineKey: 'main', totalCostIdr: null, totalSellIdr: 300_000 }
  assert.equal(lineShareCents(item, { percent: 5, basis: 'markup' }), 5_000_000)
  assert.equal(sharePotential([item, disc, noCost], { percent: 5, basis: 'markup' }), 50_000)
  const m = { ...item, totalSellIdr: 1_200_000 }
  assert.equal(sharePotential([m], { percent: 5, basis: 'margin' }), 10_000)
  assert.equal(sharePotential([m, disc, noCost], { percent: 5, basis: 'margin' }), 5_000)
  assert.equal(sharePotential([{ ...m, totalSellIdr: 900_000 }], { percent: 5, basis: 'margin' }), 0, 'booking rugi → 0, bukan negatif')
  assert.equal(sharePotential([item], null), 0)
  assert.equal(sharePotential([{ ...item, totalCostIdr: 333_333.33 }], { percent: 7.5, basis: 'markup' }), 25_000, 'dibulatkan ke sen')
})

// ── dunia uji ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 1000 } })
const savedState = await prisma.revenueSharePricingState.findMany()
assert.equal(await prisma.user.count({ where: { isPlatformProvider: true } }), 0, 'DB uji tanpa akun Platform Provider')

const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
const customer = await prisma.user.create({ data: { email: `${tag}-c@example.test`, passwordHash: 'x', fullName: 'Pelanggan', role: 'pilgrim', isActive: true } })
const staff = await prisma.user.create({ data: { email: `${tag}-s@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true } })
const route = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: 'JED' } })
const flight = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 50 } })
await prisma.productCost.create({ data: { productType: 'flight', productId: flight.id, vendorId: vendor.id, costComponent: 'tiket', currency: 'IDR', costTiers: [{ minDays: 0, maxDays: 9999, cost: 1_000_000 }] as never } })
await prisma.preferredVendor.create({ data: { productType: 'flight', productId: flight.id, costComponent: 'tiket', vendorId: vendor.id } })
const sellOf = async () => Number((await prisma.pricePoint.findFirstOrThrow({ where: { ownerType: 'flight', ownerId: flight.id } })).sellIdr)
const DRAFT: BookingDraft = { items: [{ itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-10', numPassengers: 2 }], pilgrims: [{}, {}], dueDays: 3 }
async function publish(): Promise<string> {
  const r = await createDraft(customer.id); assert.ok(r.ok)
  assert.ok((await saveDraft(r.id, DRAFT)).ok)
  const p = await publishDraft(r.id, { byUserId: staff.id }); assert.ok(p.ok, JSON.stringify(p))
  return r.id
}

await t('TANPA akun Platform Provider aktif: tak ada poin (margin 20%), harga 1.200.000, invoice terbit tanpa bagi hasil, potensi 0, penyelaras mencatat "none"', async () => {
  assert.equal(await effectiveRevenueShare(), null)
  assert.deepEqual(await resolveMarginRule('flight'), { defaultMarginPercent: 20, clientMarginPercent: 20, providerMarkupPercent: 0, roundingIncrement: 1000 })
  await repriceOwner('flight', flight.id)
  assert.equal(await sellOf(), 1_200_000)
  const b = await publish()
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { bookingId: b } })
  assert.deepEqual([inv.revenueSharePercent, inv.revenueShareBasis, inv.revenueShareSettingId], [null, null, null])
  assert.deepEqual(await bookingSharePotential(prisma, b), { rule: null, potentialIdr: 0 })
  await ensurePricesFollowRevenueShare()
  assert.equal((await prisma.revenueSharePricingState.findUniqueOrThrow({ where: { id: 'global' } })).ruleKey, 'none')
  assert.equal(await ensurePricesFollowRevenueShare(), false, 'aturan tak berubah → tidak menghitung ulang')
})

const provider = await prisma.user.create({ data: { email: `${tag}-pp@example.test`, passwordHash: 'x', fullName: 'Provider', role: 'superadmin', isActive: true, isPlatformProvider: true } })
let markupBooking = ''
await t('AKUN Platform Provider dipasang (bawaan 5% markup): margin 20% + 5 poin; penyelaras menghitung ulang SEKALI → harga 1.250.000; invoice beku 5% markup (tanpa versi = bawaan); potensi 2 orang = 100.000', async () => {
  assert.deepEqual(await effectiveRevenueShare(), { settingId: null, percent: 5, basis: 'markup' })
  assert.deepEqual(await resolveMarginRule('flight'), { defaultMarginPercent: 25, clientMarginPercent: 20, providerMarkupPercent: 5, roundingIncrement: 1000 })
  const early = await publish() // penanda masih "none" (harga belum memuat poin) → invoice tanpa bagi hasil (SEC-279)
  assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { bookingId: early } })).revenueSharePercent, null)
  assert.equal(await ensurePricesFollowRevenueShare(), true)
  assert.equal(await sellOf(), 1_250_000)
  const st = await prisma.revenueSharePricingState.findUniqueOrThrow({ where: { id: 'global' } })
  assert.deepEqual([st.ruleKey, Number(st.percent), st.basis, st.settingId], ['5:markup', 5, 'markup', null])
  assert.equal(await ensurePricesFollowRevenueShare(), false)
  markupBooking = await publish()
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { bookingId: markupBooking } })
  assert.deepEqual([Number(inv.revenueSharePercent), inv.revenueShareBasis, inv.revenueShareSettingId], [5, 'markup', null])
  assert.equal(Number((await prisma.booking.findUniqueOrThrow({ where: { id: markupBooking } })).totalAmount), 2_500_000)
  assert.deepEqual(await bookingSharePotential(prisma, markupBooking), { rule: { percent: 5, basis: 'markup' }, potentialIdr: 100_000 })
})

await t('BEKU (P4): setelan diubah ke margin 10% → harga kembali 1.200.000 (tanpa poin), invoice baru beku 10% margin + id versi, invoice LAMA tetap 5% markup dan potensinya tak berubah', async () => {
  const c = await currentRevenueShare()
  const v = await saveRevenueShare({ percent: 10, basis: 'margin', note: null, expectedId: c.id }, provider.id)
  assert.equal(revenueShareRuleKey(await effectiveRevenueShare()), '10:margin')
  assert.equal((await resolveMarginRule('flight')).providerMarkupPercent, 0)
  assert.equal(await ensurePricesFollowRevenueShare(), true)
  assert.equal(await sellOf(), 1_200_000)
  const b = await publish()
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { bookingId: b } })
  assert.deepEqual([Number(inv.revenueSharePercent), inv.revenueShareBasis, inv.revenueShareSettingId], [10, 'margin', v.id])
  assert.equal((await bookingSharePotential(prisma, b)).potentialIdr, 40_000, '10% × (2.400.000 − 2.000.000)')
  assert.equal((await bookingSharePotential(prisma, markupBooking)).potentialIdr, 100_000, 'booking lama tetap aturan bekunya')
})

await t('JEDA (SEC-279): setelan disimpan tetapi harga belum dihitung ulang → invoice membekukan aturan yang SUDAH DITERAPKAN (10% margin), bukan setelan baru (6% markup); setelah penyelaras jalan baru 6% markup', async () => {
  const c = await currentRevenueShare()
  const v = await saveRevenueShare({ percent: 6, basis: 'markup', note: null, expectedId: c.id }, provider.id)
  assert.equal(await sellOf(), 1_200_000, 'harga belum berubah')
  const b1 = await publish()
  const i1 = await prisma.invoice.findUniqueOrThrow({ where: { bookingId: b1 } })
  assert.deepEqual([Number(i1.revenueSharePercent), i1.revenueShareBasis], [10, 'margin'])
  assert.equal(await ensurePricesFollowRevenueShare(), true)
  assert.equal(await sellOf(), 1_260_000)
  const b2 = await publish()
  const i2 = await prisma.invoice.findUniqueOrThrow({ where: { bookingId: b2 } })
  assert.deepEqual([Number(i2.revenueSharePercent), i2.revenueShareBasis, i2.revenueShareSettingId], [6, 'markup', v.id])
  assert.equal((await bookingSharePotential(prisma, b2)).potentialIdr, 120_000, '6% × modal 2.000.000')
})

await t('DB: CHECK bentuk penanda harga — "none" dengan persen, atau persen tanpa dasar, ditolak', async () => {
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "revenue_share_pricing_state" SET "ruleKey" = 'none' WHERE "id" = 'global'`), /revenue_share_pricing_state_shape/)
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "revenue_share_pricing_state" SET "basis" = NULL WHERE "id" = 'global'`), /revenue_share_pricing_state_shape/)
})

await t('AKUN Platform Provider dicabut → tak ada bagi hasil lagi: harga kembali tanpa poin, invoice baru tanpa aturan', async () => {
  await prisma.user.update({ where: { id: provider.id }, data: { isPlatformProvider: false, sessionVersion: { increment: 1 } } })
  assert.equal(await effectiveRevenueShare(), null)
  assert.equal(await ensurePricesFollowRevenueShare(), true)
  assert.equal(await sellOf(), 1_200_000)
  assert.deepEqual(await revenueShareForIssue(prisma), null)
  const b = await publish()
  assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { bookingId: b } })).revenueSharePercent, null)
})

await t('DB: CHECK bentuk bagi hasil invoice — persen tanpa dasar, id versi tanpa persen, persen > 50 ditolak', async () => {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { bookingId: markupBooking } })
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "invoices" SET "revenueShareBasis" = NULL WHERE "id" = $1`, inv.id), /invoices_revenue_share_shape/)
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "invoices" SET "revenueSharePercent" = 60 WHERE "id" = $1`, inv.id), /invoices_revenue_share_shape/)
  const v = await prisma.revenueShareSetting.findFirstOrThrow()
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "invoices" SET "revenueSharePercent" = NULL, "revenueShareBasis" = NULL, "revenueShareSettingId" = $2 WHERE "id" = $1`, inv.id, v.id), /invoices_revenue_share_shape/)
})

const SRC = [...files('app'), ...files('components'), ...files('lib')]
await t('PENJAGA: kolom revenueShare* invoice hanya ditulis issue.ts (lewat revenueShareForIssue); penanda harga hanya lib/revenue-share/pricing.ts; poin markup hanya di resolveMarginRule; rumus harga memakai resolveMarginRule', () => {
  assert.deepEqual(SRC.filter(f => /revenueShareForIssue\(/.test(read(f))).sort(), ['lib/invoice/issue.ts', 'lib/revenue-share/settings.ts'])
  assert.doesNotMatch(read('lib/revenue-share/settings.ts').split('export async function revenueShareForIssue')[1]?.split('\n}')[0] ?? '', /effectiveRevenueShare|revenueShareSetting\./, 'invoice membekukan aturan yang diterapkan, bukan setelan terbaru')
  assert.match(read('app/api/v1/admin/pricing/points/route.ts'), /SUPERADMIN_ROLES\.includes\(session\.role\) \? \{ clientMarginPercent/, 'rincian poin hanya superadmin (SEC-281)')
  assert.deepEqual(SRC.filter(f => /revenueSharePercent\s*:/.test(read(f)) && !/^lib\/revenue-share\//.test(f)), ['lib/invoice/issue.ts'])
  assert.deepEqual(SRC.filter(f => /revenueSharePricingState\.(create|update|upsert|delete)/.test(read(f))), ['lib/revenue-share/pricing.ts'])
  assert.deepEqual(SRC.filter(f => /providerMarkupPercent\s*=/.test(read(f))), ['lib/pricing/pricingHelpers.ts'])
  for (const f of ['lib/pricing/computeSellPrice.ts', 'lib/pricing/costComponents.ts', 'lib/pricing/simulateSellPrice.ts', 'lib/pricing/engine/owners/composite.ts']) assert.match(read(f), /resolveMarginRule\(/, f)
  assert.match(read('app/api/v1/admin/system/platform-provider/route.ts'), /saveRevenueShare\([\s\S]*ensurePricesFollowRevenueShare\(\)/)
  assert.match(read('instrumentation-node.ts'), /startRevenueSharePricingJob\(\)/)
  assert.match(read('instrumentation-node.ts'), /ensurePricesFollowRevenueShare\(\)/)
})

// ── pembersihan ───────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.deleteMany({ where: { userId: customer.id } })
await prisma.flightSchedule.deleteMany({ where: { routeId: route.id } })
await prisma.flightRoute.delete({ where: { id: route.id } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
const testUsers = (await prisma.user.findMany({ where: { email: { startsWith: `${tag}-` } }, select: { id: true } })).map(u => u.id)
// Versi setelan append-only (trigger) merujuk akun uji (FK Restrict): DB sekali pakai saja, trigger dimatikan untuk transaksi pembersih (pola test-revenue-share).
await prisma.$transaction(async tx => {
  await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
  await tx.revenueShareSetting.deleteMany({ where: { createdById: { in: testUsers } } })
})
await prisma.user.deleteMany({ where: { id: { in: testUsers } } })
await prisma.revenueSharePricingState.deleteMany({})
for (const s of savedState) await prisma.revenueSharePricingState.create({ data: s })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
await refreshAllPricingCaches() // harga produk lain kembali tanpa poin uji (penyelaras menghitung ulang SEMUA harga selama uji)
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
