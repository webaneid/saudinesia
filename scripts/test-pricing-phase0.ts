// Fase 0 harga terpadu (docs/arsitektur-harga-terpadu.md): harga katering dihitung SERVER-SIDE, aturan margin global satu-satunya + nilai bawaan
// satu tempat, dan perubahan margin menyegarkan SEMUA cache harga (bukan hanya Visa) terhadap DATABASE SUNGGUHAN.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { computeCateringBookingPrice, cateringPricePerPersonPerDay } from '@/lib/pricing/computeCateringPrice'
import { DEFAULT_MARGIN_PERCENT, DEFAULT_ROUNDING_INCREMENT, GLOBAL_RULE_KEY, resolveMarginRule } from '@/lib/pricing/pricingHelpers'
import { PRICE_CACHE_STEP_NAMES, refreshAllPricingCaches } from '@/lib/pricing/refreshAll'
import { refreshHotelRoomScheduleCache } from '@/lib/pricing/refreshHotelRoomScheduleCache'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const tag = `ph0${Date.now()}`
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]

// aturan margin global asli dipulihkan di akhir
const savedGlobal = await prisma.pricingRule.findFirst({ where: { productType: GLOBAL_RULE_KEY } })
const savedTyped = await prisma.pricingRule.findMany({ where: { productType: { not: GLOBAL_RULE_KEY } } })
await prisma.pricingRule.deleteMany({})

// musim sementara di tahun 2090 (tak bertabrakan dengan data lain)
const seasons = await Promise.all([
  prisma.season.create({ data: { name: 'ramadan', startDate: new Date('2090-03-01'), endDate: new Date('2090-03-30') } }),
  prisma.season.create({ data: { name: 'hajj', startDate: new Date('2090-06-01'), endDate: new Date('2090-06-20') } }),
])

// ── KATERING ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const opt = await prisma.cateringOption.create({ data: { name: `${tag} katering`, boardType: 'full_board', menuStyle: 'asian', pricePerPersonRegular: 100000, pricePerPersonRamadan: 150000, pricePerPersonHajj: 200000 } })
const inactive = await prisma.cateringOption.create({ data: { name: `${tag} nonaktif`, boardType: 'full_board', menuStyle: 'asian', pricePerPersonRegular: 100000, pricePerPersonRamadan: 100000, pricePerPersonHajj: 100000, isActive: false } })
const noHajjPrice = await prisma.cateringOption.create({ data: { name: `${tag} tanpa harga haji`, boardType: 'full_board', menuStyle: 'asian', pricePerPersonRegular: 100000, pricePerPersonRamadan: 100000, pricePerPersonHajj: 0 } })
// Sejak Fase 3 harga katering dibaca dari titik harga (tiga musim) — fixture memberi titik sesuai harga kolom (0 = belum berharga = tanpa titik).
const seasonPoints = async (o: { id: string; pricePerPersonRegular: unknown; pricePerPersonRamadan: unknown; pricePerPersonHajj: unknown }) => {
  for (const [season, value] of [['regular', o.pricePerPersonRegular], ['ramadan', o.pricePerPersonRamadan], ['hajj', o.pricePerPersonHajj]] as const) {
    if (Number(value) > 0) await prisma.pricePoint.create({ data: { ownerType: 'catering', ownerId: o.id, variantKey: `season:${season}`, unit: 'person_day', manualSellIdr: Number(value), sellIdr: Number(value) } })
  }
}
for (const o of [opt, inactive, noHajjPrice]) await seasonPoints(o)
const price = async (id: string, start: string, numDays = 3, numPeople = 4) => {
  const { season, pricePerPersonPerDay, totalPrice } = await computeCateringBookingPrice({ cateringOptionId: id, startDate: new Date(start), numDays, numPeople })
  return { season, pricePerPersonPerDay, totalPrice } // `point` (jejak titik harga untuk snapshot) diuji di test-booking-snapshot
}

await t('katering: harga = harga musim PADA TANGGAL MULAI × hari × orang (reguler / Ramadan / Haji)', async () => {
  assert.deepEqual(await price(opt.id, '2090-01-10'), { season: 'regular', pricePerPersonPerDay: 100000, totalPrice: 1_200_000 })
  assert.deepEqual(await price(opt.id, '2090-03-10'), { season: 'ramadan', pricePerPersonPerDay: 150000, totalPrice: 1_800_000 })
  assert.deepEqual(await price(opt.id, '2090-06-10'), { season: 'hajj', pricePerPersonPerDay: 200000, totalPrice: 2_400_000 })
  assert.equal((await price(opt.id, '2090-03-10', 10, 1)).totalPrice, 1_500_000)
})
await t('katering: opsi tak ada / nonaktif / harga musim itu 0 → ItemNotBookableError (422), tak pernah gratis', async () => {
  const notBookable = (e: unknown) => e instanceof ItemNotBookableError
  await assert.rejects(() => price('00000000-0000-4000-8000-000000000000', '2090-01-10'), notBookable)
  await assert.rejects(() => price(inactive.id, '2090-01-10'), notBookable)
  await assert.rejects(() => price(noHajjPrice.id, '2090-06-10'), notBookable)
  assert.equal((await price(noHajjPrice.id, '2090-01-10')).totalPrice, 1_200_000, 'musim lain tetap bisa dipesan')
})
await t('katering: skema booking TIDAK punya totalPrice (klien tak bisa menentukan harga) dan route tak membacanya', () => {
  const schema = readFileSync('lib/validators/booking.ts', 'utf8')
  const block = schema.slice(schema.indexOf("itemType: z.literal('catering')"), schema.indexOf("itemType: z.literal('tourPackage')"))
  assert.ok(block.includes('cateringOptionId') && block.includes('numPeople'), 'blok katering tidak ditemukan')
  assert.doesNotMatch(block.replace(/\/\/.*$/gm, ''), /totalPrice/, 'skema katering tak boleh menerima totalPrice')
  const route = readFileSync('app/api/v1/bookings/route.ts', 'utf8')
  const items = readFileSync('lib/booking/lineItems.ts', 'utf8')
  assert.doesNotMatch(route, /item\.totalPrice/, 'route tak boleh memakai totalPrice dari klien')
  assert.doesNotMatch(items, /item\.totalPrice/, 'lineItems tak boleh memakai totalPrice dari klien')
  assert.match(items, /computeCateringBookingPrice\(/, 'katering harus dihitung lewat computeCateringBookingPrice (lib/booking/lineItems.ts)')
})
await t('katering: katalog publik dan booking memilih kolom musim lewat SATU fungsi', () => {
  assert.equal(cateringPricePerPersonPerDay({ regular: 100000, ramadan: 150000, hajj: 200000 }, 'ramadan'), 150000)
  for (const f of ['app/api/v1/catalog/catering/route.ts', 'app/[locale]/(public)/catering/page.tsx']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /cateringPricePerPersonPerDay\(/, f); assert.doesNotMatch(src, /pricePerPerson\$\{/, `${f}: pemilihan kolom musim ganda`)
  }
})

// ── ATURAN MARGIN ────────────────────────────────────────────────────────────────────────────────────────────────────
await t('aturan margin: nilai bawaan SATU tempat; override tipe mengalahkan global; global mengalahkan bawaan', async () => {
  // Nilai bawaan bisnis yang terdokumentasi (docs/arsitektur-harga.md §3.4): mengubahnya harus keputusan sadar, bukan efek samping.
  assert.equal(DEFAULT_MARGIN_PERCENT, 20); assert.equal(DEFAULT_ROUNDING_INCREMENT, 50000)
  assert.deepEqual(await resolveMarginRule('hotel'), { minMarginPercent: DEFAULT_MARGIN_PERCENT, roundingIncrement: DEFAULT_ROUNDING_INCREMENT }, 'tanpa baris → bawaan')
  await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, minMarginPercent: 30, roundingIncrement: 100000 } })
  assert.deepEqual(await resolveMarginRule('hotel'), { minMarginPercent: 30, roundingIncrement: 100000 })
  await prisma.pricingRule.create({ data: { productType: 'hotel', minMarginPercent: 10, roundingIncrement: 1000 } })
  assert.deepEqual(await resolveMarginRule('hotel'), { minMarginPercent: 10, roundingIncrement: 1000 })
  assert.deepEqual(await resolveMarginRule('flight'), { minMarginPercent: 30, roundingIncrement: 100000 })
  await prisma.pricingRule.deleteMany({})
  for (const f of ['lib/pricing/computeSellPrice.ts', 'lib/pricing/costComponents.ts', 'lib/pricing/simulateSellPrice.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /resolveMarginRule\(/, f); assert.doesNotMatch(src, /: 20\b|: 50000\b/, `${f}: nilai bawaan ditulis keras`)
  }
})
await t('aturan margin global: 12 upsert PARALEL → tepat satu baris; baris global kedua / NULL ditolak DB', async () => {
  await prisma.pricingRule.deleteMany({})
  const up = () => prisma.pricingRule.upsert({ where: { productType: GLOBAL_RULE_KEY }, update: {}, create: { productType: GLOBAL_RULE_KEY, minMarginPercent: 20, roundingIncrement: 50000 } })
  await Promise.allSettled(Array.from({ length: 12 }, up))
  assert.equal(await prisma.pricingRule.count({ where: { productType: GLOBAL_RULE_KEY } }), 1)
  await assert.rejects(() => prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, minMarginPercent: 1, roundingIncrement: 1 } }), (e: { code?: string }) => e.code === 'P2002')
  await assert.rejects(() => prisma.$executeRawUnsafe(`INSERT INTO pricing_rules (id, "productType", "minMarginPercent", "roundingIncrement", "updatedAt") VALUES (gen_random_uuid(), NULL, 1, 1, now())`), /23502|Failing row|null value/i)
  const route = readFileSync('app/api/v1/admin/system/settings/pricing-rule/route.ts', 'utf8')
  assert.match(route, /pricingRule\.upsert\(/); assert.doesNotMatch(route, /productType:\s*null/, 'route tak boleh memakai NULL sebagai kunci global')
})

// ── SEMUA CACHE DISEGARKAN SAAT MARGIN BERUBAH ───────────────────────────────────────────────────────────────────────
await t('mengubah margin global + refreshAllPricingCaches() → harga Hotel (non-Visa) ikut berubah; aturan lama tidak lagi tertinggal', async () => {
  const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`.toLowerCase(), countryCode: 'SA' } })
  const roomType = await prisma.roomType.create({ data: { name: `${tag} room`, defaultCapacity: 2 } })
  const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel`, city: 'makkah' } })
  const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
  const schedule = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, price: 0, totalQuota: 5 } })
  await prisma.productCost.create({ data: { productType: 'hotel', productId: schedule.id, vendorId: vendor.id, costComponent: 'kamar', currency: 'IDR', costTiers: flat(1_000_000) } })
  await prisma.preferredVendor.create({ data: { productType: 'hotel', productId: schedule.id, costComponent: 'kamar', vendorId: vendor.id } })
  try {
    await prisma.pricingRule.deleteMany({})
    await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, minMarginPercent: 20, roundingIncrement: 50000 } })
    await refreshHotelRoomScheduleCache(schedule.id)
    assert.equal(Number((await prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).price), 1_200_000)
    await prisma.pricingRule.update({ where: { productType: GLOBAL_RULE_KEY }, data: { minMarginPercent: 50, roundingIncrement: 100000 } })
    assert.equal(Number((await prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).price), 1_200_000, 'tanpa refresh harga memang masih lama (itulah bug yang ditutup)')
    const failedSteps = await refreshAllPricingCaches()
    assert.equal(Number((await prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).price), 1_500_000, 'margin 50% dibulatkan 100.000')
    assert.deepEqual(failedSteps, [], 'tak ada langkah refresh yang gagal')
  } finally {
    await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
    await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
    await prisma.pricePoint.deleteMany({ where: { ownerId: schedule.id } })
    await prisma.hotel.deleteMany({ where: { id: hotel.id } })
    await prisma.roomType.deleteMany({ where: { id: roomType.id } })
    await prisma.vendor.deleteMany({ where: { id: vendor.id } })
    await prisma.pricingRule.deleteMany({})
  }
})
await t('penjaga sumber: semua cache dalam SATU daftar (urutan: dasar dulu, komposit terakhir); cron dan perubahan margin memakainya', () => {
  assert.deepEqual(PRICE_CACHE_STEP_NAMES, ['visa', 'flight', 'hotel', 'transport', 'muthowif', 'tour_package', 'package', 'haji', 'catering', 'hotel_service'])
  const cron = readFileSync('lib/cron/exchangeRateJob.ts', 'utf8')
  assert.match(cron, /refreshAllPricingCaches\(updatedCurrencies\)/); assert.doesNotMatch(cron, /refreshAll(Visa|Flight|Hotel|Transport|Muthowif|TourPackage|Package|Haji)/, 'cron tak boleh punya daftar refresh sendiri')
  const route = readFileSync('app/api/v1/admin/system/settings/pricing-rule/route.ts', 'utf8')
  assert.match(route, /refreshAllPricingCaches\(\)/); assert.doesNotMatch(route, /refreshAllVisaProductCaches/, 'perubahan margin tak boleh hanya menyegarkan Visa')
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.pricePoint.deleteMany({ where: { ownerType: 'catering', ownerId: { in: [opt.id, inactive.id, noHajjPrice.id] } } })
await prisma.cateringOption.deleteMany({ where: { id: { in: [opt.id, inactive.id, noHajjPrice.id] } } })
await prisma.season.deleteMany({ where: { id: { in: seasons.map(s => s.id) } } })
await prisma.pricingRule.deleteMany({})
if (savedGlobal) await prisma.pricingRule.create({ data: { productType: savedGlobal.productType, minMarginPercent: savedGlobal.minMarginPercent, roundingIncrement: savedGlobal.roundingIncrement } })
if (savedTyped.length) await prisma.pricingRule.createMany({ data: savedTyped.map(({ productType, minMarginPercent, roundingIncrement }) => ({ productType, minMarginPercent, roundingIncrement })) })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
