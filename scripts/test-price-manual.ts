// Fase 3 harga terpadu (docs/arsitektur-harga-terpadu.md §16): harga jual MANUAL, jejak audit, modal manual (pemilik manual-only), Kesehatan Margin, policy peran.
// Terhadap DATABASE SUNGGUHAN. Dibuktikan: manual menang atas otomatis dan bertahan dari hitung-ulang (juga yang PARALEL), jual < modal wajib bercatatan, batas nilai,
// kembali ke otomatis, tiap perubahan tercatat (siapa/dari→ke/catatan), kolom lama ikut (penulisan ganda), Visa per tier (+prune), katering tiga musim + booking memakainya,
// Kesehatan Margin menandai rugi/tipis/modal kosong/belum berharga dengan hitungan benar dan berhalaman, dan penjaga sumber (penulis harga manual & jejak hanya mesin).
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import {
  clearManualSell, getPricePoint, getPricePoints, listPriceChanges, marginHealth, MAX_PRICE_IDR, PriceInputError, repriceAll, repriceOwner, setManualCost, setManualSell,
} from '@/lib/pricing/engine'
import { requireSellPrice, cateringSeasonPrices } from '@/lib/pricing/engine/read'
import { computeCateringBookingPrice } from '@/lib/pricing/computeCateringPrice'
import { canChangeMarginRule, canSetSellPrice, canViewCost } from '@/lib/pricing/policy'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `pm${Date.now()}`
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]
const who = `user-${tag}`
const rejects = (fn: () => Promise<unknown>, re: RegExp) => assert.rejects(fn, (e: unknown) => e instanceof PriceInputError && re.test((e as Error).message))

const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, minMarginPercent: 20, roundingIncrement: 50000, warnBelowPercent: 10 } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`.toLowerCase(), countryCode: 'SA' } })
const roomType = await prisma.roomType.create({ data: { name: `${tag} room`, defaultCapacity: 2 } })
async function newSchedule(cost?: number) {
  const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel ${Math.random()}`, city: 'makkah' } })
  const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
  const schedule = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, price: 0, totalQuota: 5 } })
  if (cost !== undefined) {
    await prisma.productCost.create({ data: { productType: 'hotel', productId: schedule.id, vendorId: vendor.id, costComponent: 'kamar', currency: 'IDR', costTiers: flat(cost) } })
    await prisma.preferredVendor.create({ data: { productType: 'hotel', productId: schedule.id, costComponent: 'kamar', vendorId: vendor.id } })
    await repriceOwner('hotel', schedule.id)
  }
  return { hotel, schedule }
}
const column = async (id: string) => Number((await prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id } })).price)

// ── MANUAL ───────────────────────────────────────────────────────────────────────────────────────────────────────────
await t('harga manual menang atas otomatis, mencatat siapa/kapan/catatan, menulis kolom lama, dan bertahan dari hitung-ulang saat modal/margin berubah', async () => {
  const h = await newSchedule(1_000_000) // otomatis 1.200.000
  const v = await setManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, sellIdr: 1_350_000, note: 'harga promo musim', byUserId: who })
  assert.deepEqual([v.sellIdr, v.mode, v.costIdr, v.profitIdr], [1_350_000, 'manual', 1_000_000, 350_000])
  assert.equal(await column(h.schedule.id), 1_350_000, 'kolom lama = harga efektif')
  const row = await prisma.pricePoint.findFirstOrThrow({ where: { ownerId: h.schedule.id } })
  assert.deepEqual([Number(row.autoSellIdr), row.manualNote, row.manualBy, row.manualAt != null], [1_200_000, 'harga promo musim', who, true])
  await prisma.productCost.updateMany({ where: { productId: h.schedule.id }, data: { costTiers: flat(1_500_000) } })
  await prisma.pricingRule.update({ where: { productType: GLOBAL_RULE_KEY }, data: { minMarginPercent: 50 } })
  await repriceAll()
  const after = await getPricePoint('hotel', h.schedule.id)
  assert.deepEqual([after?.costIdr, after?.sellIdr, after?.mode], [1_500_000, 1_350_000, 'manual'], 'modal naik, jual manual tetap, untung negatif terlihat')
  assert.equal(Number((await prisma.pricePoint.findFirstOrThrow({ where: { ownerId: h.schedule.id } })).autoSellIdr), 2_250_000, 'otomatis ikut margin baru')
  await prisma.pricingRule.update({ where: { productType: GLOBAL_RULE_KEY }, data: { minMarginPercent: 20 } })
})

await t('jual DI BAWAH modal wajib bercatatan (tidak diblokir bila ada); modal tidak diketahui → tanpa syarat; tanpa titik → dibuat (jual tanpa modal)', async () => {
  const h = await newSchedule(2_000_000)
  await rejects(() => setManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, sellIdr: 1_800_000, byUserId: who }), /catatan/i)
  await rejects(() => setManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, sellIdr: 1_800_000, note: '  ', byUserId: who }), /catatan/i)
  await rejects(() => setManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, sellIdr: 1_800_000, note: 'x', byUserId: who }), /catatan/i)
  const v = await setManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, sellIdr: 1_800_000, note: 'negosiasi grup besar', byUserId: who })
  assert.deepEqual([v.sellIdr, v.profitIdr], [1_800_000, -200_000])
  const nocost = await newSchedule()
  assert.equal(await getPricePoint('hotel', nocost.schedule.id), null)
  const v2 = await setManualSell({ ownerType: 'hotel', ownerId: nocost.schedule.id, sellIdr: 500_000, byUserId: who })
  assert.deepEqual([v2.costIdr, v2.sellIdr, v2.mode, v2.profitIdr], [null, 500_000, 'manual', null])
  assert.equal(await column(nocost.schedule.id), 500_000)
  assert.equal(await requireSellPrice('hotel', nocost.schedule.id, 'kamar'), 500_000, 'langsung dapat dipesan')
})

await t('batas masukan: ≤ 0, NaN/Infinity, di atas batas atas, varian yang belum ada, dan produk yang tak ada → PriceInputError (400)', async () => {
  const h = await newSchedule(1_000_000)
  const base = { ownerType: 'hotel' as const, ownerId: h.schedule.id, byUserId: who }
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, MAX_PRICE_IDR + 1]) await rejects(() => setManualSell({ ...base, sellIdr: bad }), /harga jual/i)
  await rejects(() => setManualSell({ ...base, variantKey: 'days:1-5', sellIdr: 1 }), /belum ada/i)
  await rejects(() => setManualSell({ ownerType: 'hotel', ownerId: '00000000-0000-4000-8000-000000000000', sellIdr: 1_000_000, byUserId: who }), /tidak ditemukan/i)
  assert.equal(await column(h.schedule.id), 1_200_000, 'tak ada yang berubah setelah penolakan')
  assert.equal((await prisma.priceChange.count({ where: { ownerId: h.schedule.id } })), 0, 'penolakan tak meninggalkan jejak')
  const ok = await setManualSell({ ...base, sellIdr: MAX_PRICE_IDR, note: 'batas atas sah' })
  assert.equal(ok.sellIdr, MAX_PRICE_IDR)
})

await t('kembali ke otomatis: harga = modal × margin, kolom lama ikut, jejak manual_clear; menolak bila tak sedang manual atau tak ada harga otomatis', async () => {
  const h = await newSchedule(1_000_000)
  await rejects(() => clearManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, byUserId: who }), /tidak sedang diatur manual/i)
  await setManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, sellIdr: 2_000_000, byUserId: who })
  const v = await clearManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, note: 'promo selesai', byUserId: who })
  assert.deepEqual([v.sellIdr, v.mode], [1_200_000, 'auto'])
  assert.equal(await column(h.schedule.id), 1_200_000)
  const row = await prisma.pricePoint.findFirstOrThrow({ where: { ownerId: h.schedule.id } })
  assert.deepEqual([row.manualSellIdr, row.manualNote, row.manualBy, row.manualAt], [null, null, null, null])
  const noAuto = await newSchedule()
  await setManualSell({ ownerType: 'hotel', ownerId: noAuto.schedule.id, sellIdr: 700_000, byUserId: who })
  await rejects(() => clearManualSell({ ownerType: 'hotel', ownerId: noAuto.schedule.id, byUserId: who }), /belum ada harga otomatis/i)
})

await t('jejak audit: tiap atur/kembalikan tercatat berurutan (terbaru dulu) dengan siapa, dari→ke, modal, catatan', async () => {
  const h = await newSchedule(1_000_000)
  await setManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, sellIdr: 1_400_000, note: 'a', byUserId: 'u-1' })
  await setManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, sellIdr: 1_100_000, note: 'turun sedikit', byUserId: 'u-2' })
  await clearManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, byUserId: 'u-3' })
  const log = await listPriceChanges('hotel', h.schedule.id)
  assert.deepEqual(log.map(c => [c.kind, c.oldSellIdr, c.newSellIdr, c.byUserId, c.note]), [
    ['manual_clear', 1_100_000, 1_200_000, 'u-3', null],
    ['manual_set', 1_400_000, 1_100_000, 'u-2', 'turun sedikit'],
    ['manual_set', 1_200_000, 1_400_000, 'u-1', 'a'],
  ])
  assert.ok(log.every(c => c.newCostIdr === 1_000_000), 'modal saat perubahan ikut tercatat')
  assert.equal((await listPriceChanges('hotel', h.schedule.id, 2)).length, 2, 'batas jumlah')
})

await t('PARALEL: hitung-ulang dan atur-manual bersamaan → harga manual TIDAK hilang (kunci baris), tak ada baris ganda', async () => {
  const h = await newSchedule(1_000_000)
  await Promise.all([
    ...Array.from({ length: 6 }, () => repriceOwner('hotel', h.schedule.id).catch(() => undefined)),
    setManualSell({ ownerType: 'hotel', ownerId: h.schedule.id, sellIdr: 1_777_000, note: 'paralel', byUserId: who }),
    ...Array.from({ length: 6 }, () => repriceOwner('hotel', h.schedule.id).catch(() => undefined)),
  ])
  const v = await getPricePoint('hotel', h.schedule.id)
  assert.deepEqual([v?.sellIdr, v?.mode], [1_777_000, 'manual'])
  assert.equal(await prisma.pricePoint.count({ where: { ownerId: h.schedule.id } }), 1)
  assert.equal(await column(h.schedule.id), 1_777_000)
})

// ── VISA per tier ────────────────────────────────────────────────────────────────────────────────────────────────────
const visa = await prisma.visaProduct.create({ data: { name: `${tag} visa`, visaType: 'Umroh', price: 0 } })
await prisma.productCost.create({ data: { productType: 'visa', productId: visa.id, vendorId: vendor.id, costComponent: 'individu', currency: 'IDR', costTiers: [{ minDays: 1, maxDays: 14, cost: 1_000_000 }, { minDays: 15, maxDays: 30, cost: 2_000_000 }] } })
await prisma.preferredVendor.create({ data: { productType: 'visa', productId: visa.id, costComponent: 'individu', vendorId: vendor.id } })
await repriceOwner('visa', visa.id)
await t('Visa: harga manual per tier; durationFeeRules + "mulai dari" ikut; bertahan dari hitung-ulang; tier dibuang → varian dibuang tetapi jejak tetap', async () => {
  await setManualSell({ ownerType: 'visa', ownerId: visa.id, variantKey: 'days:15-30', sellIdr: 2_900_000, byUserId: who })
  let row = await prisma.visaProduct.findUniqueOrThrow({ where: { id: visa.id } })
  assert.deepEqual(row.durationFeeRules, [{ minDays: 1, maxDays: 14, fee: 1_200_000 }, { minDays: 15, maxDays: 30, fee: 2_900_000 }])
  assert.equal(Number(row.price), 1_200_000)
  await setManualSell({ ownerType: 'visa', ownerId: visa.id, variantKey: 'days:1-14', sellIdr: 3_000_000, byUserId: who })
  row = await prisma.visaProduct.findUniqueOrThrow({ where: { id: visa.id } })
  assert.equal(Number(row.price), 2_900_000, '"mulai dari" = termurah setelah tier pertama dinaikkan')
  await repriceOwner('visa', visa.id)
  assert.deepEqual((await getPricePoints('visa', visa.id)).map(p => [p.variantKey, p.sellIdr, p.mode]), [['days:1-14', 3_000_000, 'manual'], ['days:15-30', 2_900_000, 'manual']])
  await prisma.productCost.updateMany({ where: { productId: visa.id }, data: { costTiers: [{ minDays: 1, maxDays: 14, cost: 1_000_000 }] } })
  await repriceOwner('visa', visa.id)
  assert.deepEqual((await getPricePoints('visa', visa.id)).map(p => p.variantKey), ['days:1-14'])
  assert.equal((await listPriceChanges('visa', visa.id)).filter(c => c.variantKey === 'days:15-30').length, 1, 'jejak varian yang dibuang tetap ada')
})

// ── PEMILIK MANUAL-ONLY ─────────────────────────────────────────────────────────────────────────────────────────────
const cat = await prisma.cateringOption.create({ data: { name: `${tag} katering`, boardType: 'full_board', menuStyle: 'asian', pricePerPersonRegular: 0, pricePerPersonRamadan: 0, pricePerPersonHajj: 0 } })
await t('katering (manual-only): harga per musim lewat mesin → titik harga + kolom lama; musim tak dikenal ditolak; modal opsional lewat setManualCost; hitung-ulang tak menyentuh', async () => {
  await setManualSell({ ownerType: 'catering', ownerId: cat.id, variantKey: 'season:regular', sellIdr: 100_000, byUserId: who })
  await setManualSell({ ownerType: 'catering', ownerId: cat.id, variantKey: 'season:hajj', sellIdr: 250_000, byUserId: who })
  await rejects(() => setManualSell({ ownerType: 'catering', ownerId: cat.id, variantKey: 'season:musim-lain', sellIdr: 1, byUserId: who }), /belum ada/i)
  const col = await prisma.cateringOption.findUniqueOrThrow({ where: { id: cat.id } })
  assert.deepEqual([Number(col.pricePerPersonRegular), Number(col.pricePerPersonRamadan), Number(col.pricePerPersonHajj)], [100_000, 0, 250_000], 'kolom lama ikut; musim tanpa titik tak diubah')
  assert.deepEqual((await cateringSeasonPrices([cat.id])).get(cat.id), { regular: 100_000, ramadan: 0, hajj: 250_000 })
  const withCost = await setManualCost({ ownerType: 'catering', ownerId: cat.id, variantKey: 'season:regular', costIdr: 70_000, byUserId: who })
  assert.deepEqual([withCost.costIdr, withCost.sellIdr, withCost.profitIdr], [70_000, 100_000, 30_000])
  await rejects(() => setManualCost({ ownerType: 'catering', ownerId: cat.id, variantKey: 'season:ramadan', costIdr: 1, byUserId: who }), /harga jual lebih dulu/i)
  await repriceAll()
  assert.equal((await getPricePoint('catering', cat.id, 'season:regular'))?.costIdr, 70_000, 'modal manual tak ditimpa hitung-ulang')
  const cleared = await setManualCost({ ownerType: 'catering', ownerId: cat.id, variantKey: 'season:regular', costIdr: null, byUserId: who })
  assert.equal(cleared.costIdr, null)
  assert.equal((await listPriceChanges('catering', cat.id)).filter(c => c.kind === 'cost_set').length, 2)
})
await t('modal pemilik berbasis perhitungan (hotel) TIDAK bisa diubah lewat setManualCost; booking katering memakai titik harga musim', async () => {
  const h = await newSchedule(1_000_000)
  await rejects(() => setManualCost({ ownerType: 'hotel', ownerId: h.schedule.id, costIdr: 5, byUserId: who }), /HPP/)
  const seasons = [await prisma.season.create({ data: { name: 'ramadan', startDate: new Date('2091-03-01'), endDate: new Date('2091-03-30') } })]
  const b = await computeCateringBookingPrice({ cateringOptionId: cat.id, startDate: new Date('2091-01-10'), numDays: 3, numPeople: 2 })
  assert.deepEqual([b.season, b.pricePerPersonPerDay, b.totalPrice], ['regular', 100_000, 600_000])
  await assert.rejects(() => computeCateringBookingPrice({ cateringOptionId: cat.id, startDate: new Date('2091-03-10'), numDays: 1, numPeople: 1 }), /belum berharga/, 'musim Ramadan tanpa titik harga → tidak bisa dipesan')
  await prisma.season.deleteMany({ where: { id: { in: seasons.map(s => s.id) } } })
})

// ── KESEHATAN MARGIN ────────────────────────────────────────────────────────────────────────────────────────────────
await t('Kesehatan Margin: menandai rugi / tipis (ambang 10%) / modal kosong / belum berharga dengan hitungan benar, filter, berhalaman, nama+tautan', async () => {
  const loss = await newSchedule(1_000_000); await setManualSell({ ownerType: 'hotel', ownerId: loss.schedule.id, sellIdr: 900_000, note: 'rugi disengaja', byUserId: who })
  const thin = await newSchedule(1_000_000); await setManualSell({ ownerType: 'hotel', ownerId: thin.schedule.id, sellIdr: 1_050_000, byUserId: who }) // untung 5% < 10%
  const fine = await newSchedule(1_000_000) // 1.200.000 = untung 20%
  const nocost = await newSchedule(); await setManualSell({ ownerType: 'hotel', ownerId: nocost.schedule.id, sellIdr: 400_000, byUserId: who })
  const unpriced = await prisma.package.create({ data: { name: `${tag} paket kosong`, price: 0 } }); await repriceOwner('package', unpriced.id)
  const all = await marginHealth({ filter: 'all', pageSize: 100 })
  assert.equal(all.warnBelowPercent, 10)
  const by = (id: string) => all.rows.find(r => r.ownerId === id)
  assert.deepEqual(by(loss.schedule.id)?.issues, ['loss']); assert.equal(by(loss.schedule.id)?.profitIdr, -100_000)
  assert.deepEqual(by(thin.schedule.id)?.issues, ['thin']); assert.equal(Math.round(by(thin.schedule.id)?.marginPct ?? 0), 5)
  assert.deepEqual(by(fine.schedule.id)?.issues, [])
  assert.deepEqual(by(nocost.schedule.id)?.issues, ['no_cost'])
  assert.deepEqual(all.rows.find(r => r.ownerType === 'catering' && r.ownerId === cat.id)?.issues ?? [], [], 'katering tanpa modal BUKAN masalah (modal opsional)')
  assert.ok(by(unpriced.id)?.issues.includes('unpriced') && by(unpriced.id)?.issues.includes('no_cost'))
  const issues = await marginHealth({ filter: 'issues', pageSize: 100 })
  assert.ok(issues.rows.every(r => r.issues.length > 0) && !issues.rows.some(r => r.ownerId === fine.schedule.id))
  assert.ok(issues.rows[0]!.issues.includes('loss'), 'yang rugi di urutan paling atas')
  const onlyLoss = await marginHealth({ filter: 'loss', ownerType: 'hotel', pageSize: 100 })
  assert.ok(onlyLoss.rows.length >= 1 && onlyLoss.rows.every(r => r.issues.includes('loss') && r.ownerType === 'hotel'))
  assert.equal(onlyLoss.total, onlyLoss.rows.length, 'total filter = jumlah baris (≤ 1 halaman di sini)')
  assert.ok(all.counts.loss >= 1 && all.counts.thin >= 1 && all.counts.no_cost >= 1 && all.counts.unpriced >= 1)
  assert.equal(all.total, all.counts.all, 'filter semua = seluruh titik harga')
  assert.match(by(loss.schedule.id)?.label ?? '', /hotel/i); assert.equal(by(loss.schedule.id)?.href, `/admin/products/hotels/${loss.hotel.id}`)
  assert.equal(by(unpriced.id)?.href, `/admin/products/packages/${unpriced.id}`)
  const p1 = await marginHealth({ filter: 'all', pageSize: 2, page: 1 }), p2 = await marginHealth({ filter: 'all', pageSize: 2, page: 2 })
  assert.equal(p1.rows.length, 2); assert.ok(!p1.rows.some(r => p2.rows.some(q => q.ownerId === r.ownerId && q.variantKey === r.variantKey)), 'halaman tak tumpang-tindih')
  assert.equal(p1.total, p2.total)
  assert.equal((await marginHealth({ filter: 'all', pageSize: 100_000 })).pageSize, 100, 'batas ukuran halaman')
  await prisma.pricingRule.update({ where: { productType: GLOBAL_RULE_KEY }, data: { warnBelowPercent: 0 } })
  const noWarn = await marginHealth({ filter: 'all', pageSize: 100 })
  assert.deepEqual(noWarn.rows.find(r => r.ownerId === thin.schedule.id)?.issues, [], 'ambang 0 → margin tipis tidak ditandai (hanya rugi)')
  await prisma.package.delete({ where: { id: unpriced.id } })
})

// ── POLICY & PENJAGA SUMBER ──────────────────────────────────────────────────────────────────────────────────────────
await t('policy peran: melihat modal & mengatur harga jual = semua peran admin (keputusan pemilik), aturan margin = superadmin saja; jamaah tidak pernah', () => {
  for (const role of ['admin', 'manager', 'superadmin'] as const) { assert.equal(canViewCost(role), true, role); assert.equal(canSetSellPrice(role), true, role) }
  assert.deepEqual((['admin', 'manager', 'superadmin'] as const).map(canChangeMarginRule), [false, false, true])
  for (const role of ['pilgrim', 'agent'] as const) assert.deepEqual([canViewCost(role as never), canSetSellPrice(role as never), canChangeMarginRule(role as never)], [false, false, false])
})
await t('penjaga sumber: harga manual & jejak (price_changes) ditulis HANYA oleh mesin; route harga memakai policy (bukan pemeriksaan peran sendiri)', () => {
  const files: string[] = []
  const walk = (dir: string) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e)) files.push(p) } }
  ;['app', 'lib', 'components'].forEach(walk)
  const outside = (re: RegExp) => files.filter(f => re.test(readFileSync(f, 'utf8')) && !f.startsWith('lib/pricing/engine/'))
  assert.deepEqual(outside(/priceChange\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/), [], 'price_changes hanya boleh ditulis mesin')
  assert.deepEqual(outside(/manualSellIdr\s*:/), [], 'harga manual hanya boleh diubah mesin')
  for (const f of ['app/api/v1/admin/pricing/points/route.ts', 'app/api/v1/admin/pricing/health/route.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /requirePricing(View|Edit)\(\)/, f); assert.doesNotMatch(src, /requireSuperAdmin|requireManager|requireAdmin\(/, `${f}: peran harga hanya lewat lib/pricing/policy.ts`)
  }
  const rule = readFileSync('app/api/v1/admin/system/settings/pricing-rule/route.ts', 'utf8')
  assert.match(rule, /requireMarginRuleEdit\(\)/)
  // SEC-72: batas atas + .strict() pada masukan aturan margin (diuji hidup lewat curl di PR; di sini dijaga agar tak hilang)
  assert.match(rule, /minMarginPercent: z\.coerce\.number\(\)\.min\(0[^)]*\)\.max\(MAX_MARGIN_PERCENT/)
  assert.match(rule, /roundingIncrement: z\.coerce\.number\(\)\.int\(\)\.positive\([^)]*\)\.max\(MAX_ROUNDING_INCREMENT/)
  assert.match(rule, /\}\)\.strict\(\)/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
const sched = await prisma.hotelRoomSchedule.findMany({ where: { period: { hotel: { name: { startsWith: `${tag} hotel` } } } }, select: { id: true } })
await prisma.pricePoint.deleteMany({ where: { ownerId: { in: [...sched.map(s => s.id), visa.id, cat.id] } } })
await prisma.priceChange.deleteMany({ where: { OR: [{ ownerId: { in: [...sched.map(s => s.id), visa.id, cat.id] } }, { byUserId: { in: [who, 'u-1', 'u-2', 'u-3'] } }] } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.hotel.deleteMany({ where: { name: { startsWith: `${tag} hotel` } } })
await prisma.roomType.deleteMany({ where: { id: roomType.id } })
await prisma.visaProduct.deleteMany({ where: { id: visa.id } })
await prisma.cateringOption.deleteMany({ where: { id: cat.id } })
await prisma.vendor.deleteMany({ where: { id: vendor.id } })
await prisma.pricingRule.deleteMany({})
if (savedRules.length) await prisma.pricingRule.createMany({ data: savedRules.map(({ productType, minMarginPercent, roundingIncrement, warnBelowPercent }) => ({ productType, minMarginPercent, roundingIncrement, warnBelowPercent })) })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
