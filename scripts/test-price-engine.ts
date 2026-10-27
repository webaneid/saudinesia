// Fase 1 harga terpadu (docs/arsitektur-harga-terpadu.md §3/§4/§14): mesin harga `lib/pricing/engine` terhadap DATABASE SUNGGUHAN.
// Dibuktikan: modal/jual/untung per titik harga, harga manual menang atas otomatis, modal hilang tidak mereset harga, "jual tanpa modal" dipungut,
// tier Visa → varian (+ override jadi harga manual, tier dibuang → varian dibuang), komposit (modal = komponen + bagian yang diketahui, null bila tak lengkap),
// kolom lama TETAP ditulis ganda (ekuivalen dengan perilaku sebelum mesin), pemicu margin menyegarkan titik harga, penyapuan yatim, hapus produk membersihkan
// titik harga, serta penjaga sumber (satu penulis).
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { getPricePoint, getPricePoints, repriceAll, repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { deleteVisaProduct } from '@/lib/admin/productDelete'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const tag = `pe${Date.now()}`
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]
const cleanup: Array<() => Promise<unknown>> = []

const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, minMarginPercent: 20, roundingIncrement: 50000 } })

const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`.toLowerCase(), countryCode: 'SA' } })
const rate = await prisma.exchangeRate.create({ data: { fromCurrency: 'ZZZ', toCurrency: 'IDR', midRate: 14000, spreadPercent: 5, sellRate: 15000, source: 'TEST' } })
cleanup.push(() => prisma.exchangeRate.delete({ where: { id: rate.id } }))

async function addCost(productType: string, productId: string, component: string, cost: number, currency = 'IDR', tiers?: unknown) {
  await prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent: component, currency, costTiers: (tiers ?? flat(cost)) as never } })
  await prisma.preferredVendor.create({ data: { productType, productId, costComponent: component, vendorId: vendor.id } })
}
const roomType = await prisma.roomType.create({ data: { name: `${tag} room`, defaultCapacity: 2 } })
async function newSchedule(price = 0) {
  const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel ${Math.random()}`, city: 'makkah' } })
  const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
  const schedule = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, price, totalQuota: 5 } })
  return { hotel, schedule }
}
const hotelPrice = async (id: string) => Number((await prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id } })).price)
const n = (v: unknown) => (v == null ? null : Number(v))

// ── SATU VARIAN: modal / jual / untung ───────────────────────────────────────────────────────────────────────────────
const h1 = await newSchedule()
await addCost('hotel', h1.schedule.id, 'kamar', 1_000_000)
await t('titik harga: modal 1.000.000, jual 1.200.000 (margin 20%, bulat 50.000), untung 200.000 — dan kolom lama ditulis ganda (sama dengan perilaku sebelum mesin)', async () => {
  await repriceOwner('hotel', h1.schedule.id)
  const p = await getPricePoint('hotel', h1.schedule.id)
  assert.ok(p)
  assert.deepEqual([p.costIdr, p.sellIdr, p.profitIdr, p.mode, p.unit], [1_000_000, 1_200_000, 200_000, 'auto', 'room_night'])
  assert.equal(Math.round(p.marginPct ?? 0), 20)
  assert.equal(await hotelPrice(h1.schedule.id), 1_200_000, 'penulisan ganda ke HotelRoomSchedule.price')
  const row = await prisma.pricePoint.findUniqueOrThrow({ where: { ownerType_ownerId_variantKey: { ownerType: 'hotel', ownerId: h1.schedule.id, variantKey: '' } } })
  assert.deepEqual([n(row.marginPctUsed), row.roundingUsed, row.vendorIds], [20, 50000, [vendor.id]])
})

const h2 = await newSchedule()
await addCost('hotel', h2.schedule.id, 'kamar', 100, 'ZZZ')
await t('mata uang asing: modal = nominal × kurs jual (100 × 15.000), kurs & vendor tercatat sebagai jejak', async () => {
  await repriceOwner('hotel', h2.schedule.id)
  const row = await prisma.pricePoint.findUniqueOrThrow({ where: { ownerType_ownerId_variantKey: { ownerType: 'hotel', ownerId: h2.schedule.id, variantKey: '' } } })
  assert.deepEqual([n(row.costIdr), n(row.sellIdr)], [1_500_000, 1_800_000])
  assert.deepEqual(row.fxRateIds, [rate.id]); assert.deepEqual(row.vendorIds, [vendor.id])
})

await t('modal dihapus → harga DIPERTAHANKAN (tak direset ke 0), modal ditandai kosong; modal kembali → dihitung lagi', async () => {
  const h = await newSchedule(); await addCost('hotel', h.schedule.id, 'kamar', 2_000_000)
  await repriceOwner('hotel', h.schedule.id)
  assert.equal(await hotelPrice(h.schedule.id), 2_400_000)
  await prisma.productCost.deleteMany({ where: { productType: 'hotel', productId: h.schedule.id } })
  await repriceOwner('hotel', h.schedule.id)
  const p = await getPricePoint('hotel', h.schedule.id)
  assert.deepEqual([p?.costIdr, p?.sellIdr, p?.profitIdr], [null, 2_400_000, null], 'modal kosong → untung tak diklaim')
  assert.equal(await hotelPrice(h.schedule.id), 2_400_000, 'kolom lama tak berubah')
  await prisma.productCost.create({ data: { productType: 'hotel', productId: h.schedule.id, vendorId: vendor.id, costComponent: 'kamar', currency: 'IDR', costTiers: flat(3_000_000) } }) // vendor pilihan masih ada
  await repriceOwner('hotel', h.schedule.id)
  assert.deepEqual([(await getPricePoint('hotel', h.schedule.id))?.costIdr, await hotelPrice(h.schedule.id)], [3_000_000, 3_600_000])
})

await t('"jual tanpa modal": harga lama > 0 tanpa titik & tanpa modal dipungut (modal null); harga 0 tanpa modal → tak ada titik', async () => {
  const legacy = await newSchedule(6_000_000)
  const zero = await newSchedule(0)
  await repriceOwner('hotel', legacy.schedule.id); await repriceOwner('hotel', zero.schedule.id)
  const p = await getPricePoint('hotel', legacy.schedule.id)
  assert.deepEqual([p?.costIdr, p?.sellIdr, p?.mode], [null, 6_000_000, 'auto'])
  assert.equal(await hotelPrice(legacy.schedule.id), 6_000_000)
  assert.equal(await getPricePoint('hotel', zero.schedule.id), null)
  assert.equal(await hotelPrice(zero.schedule.id), 0)
})

await t('harga manual MENANG atas otomatis dan bertahan saat dihitung ulang (jual = manual ?? otomatis); untung ikut modal', async () => {
  const h = await newSchedule(); await addCost('hotel', h.schedule.id, 'kamar', 1_000_000)
  await repriceOwner('hotel', h.schedule.id)
  await prisma.pricePoint.update({ where: { ownerType_ownerId_variantKey: { ownerType: 'hotel', ownerId: h.schedule.id, variantKey: '' } }, data: { manualSellIdr: 1_100_000, sellIdr: 1_100_000 } })
  await prisma.productCost.updateMany({ where: { productType: 'hotel', productId: h.schedule.id }, data: { costTiers: flat(1_500_000) } })
  await repriceOwner('hotel', h.schedule.id)
  const p = await getPricePoint('hotel', h.schedule.id)
  assert.deepEqual([p?.costIdr, p?.sellIdr, p?.mode, p?.profitIdr], [1_500_000, 1_100_000, 'manual', -400_000], 'manual bertahan; modal naik → untung negatif terlihat (tak diblokir)')
  const row = await prisma.pricePoint.findUniqueOrThrow({ where: { ownerType_ownerId_variantKey: { ownerType: 'hotel', ownerId: h.schedule.id, variantKey: '' } } })
  assert.equal(n(row.autoSellIdr), 1_800_000, 'otomatis tetap dihitung di samping manual')
  assert.equal(await hotelPrice(h.schedule.id), 1_100_000, 'kolom lama = harga efektif')
})

await t('paralel: 8 hitung ulang bersamaan → tetap SATU titik harga, nilai benar', async () => {
  const h = await newSchedule(); await addCost('hotel', h.schedule.id, 'kamar', 1_000_000)
  await Promise.all(Array.from({ length: 8 }, () => repriceOwner('hotel', h.schedule.id).catch(() => undefined)))
  await repriceOwner('hotel', h.schedule.id)
  assert.equal(await prisma.pricePoint.count({ where: { ownerType: 'hotel', ownerId: h.schedule.id } }), 1)
  assert.equal((await getPricePoint('hotel', h.schedule.id))?.sellIdr, 1_200_000)
})

// ── VISA: varian per tier ────────────────────────────────────────────────────────────────────────────────────────────
const visa = await prisma.visaProduct.create({ data: { name: `${tag} visa`, visaType: 'Umroh', price: 0 } })
await addCost('visa', visa.id, 'individu', 0, 'IDR', [{ minDays: 1, maxDays: 14, cost: 1_000_000 }, { minDays: 15, maxDays: 30, cost: 1_500_000, sellPriceOverride: 1_600_000 }])
await t('Visa: satu titik harga per tier; override tier = harga manual varian; kolom lama (durationFeeRules + price termurah) ekuivalen', async () => {
  await repriceOwner('visa', visa.id)
  const pts = await getPricePoints('visa', visa.id)
  assert.deepEqual(pts.map(p => [p.variantKey, p.costIdr, p.sellIdr, p.mode]), [['days:1-14', 1_000_000, 1_200_000, 'auto'], ['days:15-30', 1_500_000, 1_600_000, 'manual']])
  const row = await prisma.visaProduct.findUniqueOrThrow({ where: { id: visa.id } })
  assert.deepEqual(row.durationFeeRules, [{ minDays: 1, maxDays: 14, fee: 1_200_000 }, { minDays: 15, maxDays: 30, fee: 1_600_000 }])
  assert.equal(Number(row.price), 1_200_000, '"mulai dari" = termurah')
  assert.equal(n((await prisma.pricePoint.findUniqueOrThrow({ where: { ownerType_ownerId_variantKey: { ownerType: 'visa', ownerId: visa.id, variantKey: 'days:15-30' } } })).autoSellIdr), 1_800_000, 'otomatis tetap tercatat di samping override')
})
await t('Visa: tier dibuang → varian dibuang (tak ada titik harga basi); semua biaya dihapus → durationFeeRules kosong, price lama dipertahankan', async () => {
  await prisma.productCost.updateMany({ where: { productType: 'visa', productId: visa.id }, data: { costTiers: [{ minDays: 1, maxDays: 14, cost: 1_000_000 }] } })
  await repriceOwner('visa', visa.id)
  assert.deepEqual((await getPricePoints('visa', visa.id)).map(p => p.variantKey), ['days:1-14'])
  await prisma.productCost.deleteMany({ where: { productType: 'visa', productId: visa.id } })
  await repriceOwner('visa', visa.id)
  assert.equal((await getPricePoints('visa', visa.id)).length, 0)
  const row = await prisma.visaProduct.findUniqueOrThrow({ where: { id: visa.id } })
  assert.deepEqual(row.durationFeeRules, []); assert.equal(Number(row.price), 1_200_000)
})

// ── KOMPOSIT ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const haji = await prisma.hajiProduct.create({ data: { name: `${tag} haji`, hajiType: 'reguler', year: 2090, price: 0 } })
await addCost('haji', haji.id, 'akomodasi', 1_030_000); await addCost('haji', haji.id, 'transportasi', 1_030_000)
await t('Haji (komposit): jual = Σ jual PER KOMPONEN (bukan satu margin atas total), modal = Σ HPP; kolom lama ditulis ganda', async () => {
  await repriceOwner('haji', haji.id)
  const p = await getPricePoint('haji', haji.id)
  // tiap komponen 1.030.000 × 1,2 = 1.236.000 → 1.250.000; dua komponen = 2.500.000 (satu margin atas 2.060.000 akan 2.450.000)
  assert.deepEqual([p?.costIdr, p?.sellIdr, p?.unit], [2_060_000, 2_500_000, 'package'])
  assert.equal(Number((await prisma.hajiProduct.findUniqueOrThrow({ where: { id: haji.id } })).price), 2_500_000)
})
await t('Haji tanpa komponen: titik harga TETAP ada bernilai 0 dengan modal null (seperti cache lama yang selalu menulis)', async () => {
  const empty = await prisma.hajiProduct.create({ data: { name: `${tag} haji kosong`, hajiType: 'reguler', year: 2090, price: 123 } })
  await repriceOwner('haji', empty.id)
  const p = await getPricePoint('haji', empty.id)
  assert.deepEqual([p?.costIdr, p?.sellIdr], [null, 0])
  assert.equal(Number((await prisma.hajiProduct.findUniqueOrThrow({ where: { id: empty.id } })).price), 0)
})

const hp = await newSchedule(); await addCost('hotel', hp.schedule.id, 'kamar', 1_000_000); await repriceOwner('hotel', hp.schedule.id)
const pkg = await prisma.package.create({
  data: {
    name: `${tag} paket`, price: 0,
    hotelMakkahMode: 'included', includedHotelMakkahScheduleId: hp.schedule.id, includedHotelMakkahNights: 3, includedHotelMakkahNumRooms: 2, includedHotelMakkahPrice: 1_200_000,
  },
})
await addCost('package', pkg.id, 'layanan', 500_000)
await t('Paket Umroh: modal = komponen + (malam × kamar × modal hotel), jual = komponen + harga hotel tersimpan; kolom lama ditulis ganda', async () => {
  await repriceOwner('package', pkg.id)
  const p = await getPricePoint('package', pkg.id)
  // jual: komponen 500.000×1,2=600.000 + hotel 3×2×1.200.000=7.200.000 ; modal: 500.000 + 3×2×1.000.000
  assert.deepEqual([p?.costIdr, p?.sellIdr, p?.profitIdr], [6_500_000, 7_800_000, 1_300_000])
  assert.equal(Number((await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } })).price), 7_800_000)
})
await t('Paket Umroh: bagian included yang modalnya TAK bisa dipastikan (muthowif) → modal paket null, jual tetap benar (untung tak diklaim)', async () => {
  await prisma.package.update({ where: { id: pkg.id }, data: { muthowifMode: 'included', includedMuthowifPrice: 400_000 } })
  await repriceOwner('package', pkg.id)
  const p = await getPricePoint('package', pkg.id)
  assert.deepEqual([p?.costIdr, p?.sellIdr, p?.profitIdr], [null, 8_200_000, null])
})
await t('Paket Umroh: hotel included yang titik harganya TANPA modal → modal paket null', async () => {
  const legacyHotel = await newSchedule(900_000); await repriceOwner('hotel', legacyHotel.schedule.id)
  const p2 = await prisma.package.create({ data: { name: `${tag} paket2`, price: 0, hotelMadinahMode: 'included', includedHotelMadinahScheduleId: legacyHotel.schedule.id, includedHotelMadinahNights: 2, includedHotelMadinahNumRooms: 1, includedHotelMadinahPrice: 900_000 } })
  await repriceOwner('package', p2.id)
  const p = await getPricePoint('package', p2.id)
  assert.deepEqual([p?.costIdr, p?.sellIdr], [null, 1_800_000])
  await prisma.package.delete({ where: { id: p2.id } })
})

const tour = await prisma.tourPackage.create({ data: { name: `${tag} ziarah`, price: 0 } })
await addCost('tour_package', tour.id, 'guide', 300_000)
await t('Paket Ziarah: modal = Σ HPP komponen, jual = Σ jual per komponen; kolom lama ditulis ganda', async () => {
  await repriceOwner('tour_package', tour.id)
  const p = await getPricePoint('tour_package', tour.id)
  assert.deepEqual([p?.costIdr, p?.sellIdr], [300_000, 350_000])
  assert.equal(Number((await prisma.tourPackage.findUniqueOrThrow({ where: { id: tour.id } })).price), 350_000)
})

// ── PEMICU: margin berubah ───────────────────────────────────────────────────────────────────────────────────────────
await t('ubah margin + repriceAll → SEMUA titik harga (dasar dan komposit) bergeser, modal tetap, kolom lama ikut', async () => {
  await prisma.pricingRule.update({ where: { productType: GLOBAL_RULE_KEY }, data: { minMarginPercent: 50, roundingIncrement: 100000 } })
  const failedOwners = await repriceAll()
  assert.deepEqual(failedOwners, [])
  const hp1 = await getPricePoint('hotel', h1.schedule.id)
  assert.deepEqual([hp1?.costIdr, hp1?.sellIdr], [1_000_000, 1_500_000])
  assert.equal(await hotelPrice(h1.schedule.id), 1_500_000)
  assert.equal((await getPricePoint('haji', haji.id))?.costIdr, 2_060_000)
  assert.equal((await getPricePoint('haji', haji.id))?.sellIdr, 3_000_000, '2 × (1.030.000×1,5=1.545.000 → 1.500.000)')
  assert.equal(n((await prisma.pricePoint.findUniqueOrThrow({ where: { ownerType_ownerId_variantKey: { ownerType: 'hotel', ownerId: h1.schedule.id, variantKey: '' } } })).marginPctUsed), 50)
})

// ── YATIM & HAPUS ────────────────────────────────────────────────────────────────────────────────────────────────────
await t('pemilik terhapus berantai (hotel) → titik harga yatim disapu; repriceOwner pada id yang sudah tak ada juga membersihkan', async () => {
  const h = await newSchedule(); await addCost('hotel', h.schedule.id, 'kamar', 1_000_000); await repriceOwner('hotel', h.schedule.id)
  assert.ok(await getPricePoint('hotel', h.schedule.id))
  await prisma.hotel.delete({ where: { id: h.hotel.id } }) // jadwal kamar ikut terhapus (CASCADE), titik harga tak punya FK
  assert.ok(await getPricePoint('hotel', h.schedule.id), 'yatim sebelum disapu')
  assert.ok((await sweepOrphanPricePoints()) >= 1)
  assert.equal(await getPricePoint('hotel', h.schedule.id), null)
  await prisma.pricePoint.create({ data: { ownerType: 'hotel', ownerId: h.schedule.id, unit: 'room_night', autoSellIdr: 1, sellIdr: 1 } })
  await repriceOwner('hotel', h.schedule.id)
  assert.equal(await getPricePoint('hotel', h.schedule.id), null)
})
await t('hapus produk lewat deleteVisaProduct → titik harga Visa ikut terhapus dalam transaksi yang sama', async () => {
  const v = await prisma.visaProduct.create({ data: { name: `${tag} visa hapus`, visaType: 'Umroh', price: 0 } })
  await addCost('visa', v.id, 'individu', 0, 'IDR', [{ minDays: 1, maxDays: 14, cost: 1_000_000 }])
  await repriceOwner('visa', v.id)
  assert.equal((await getPricePoints('visa', v.id)).length, 1)
  const outcome = await deleteVisaProduct(v.id)
  assert.equal(outcome.deleted, true)
  assert.equal((await getPricePoints('visa', v.id)).length, 0)
})

// ── PENJAGA SUMBER ───────────────────────────────────────────────────────────────────────────────────────────────────
await t('penjaga sumber: HANYA lib/pricing/engine yang menulis price_points dan kolom harga lama produk berharga mesin', () => {
  const roots = ['app', 'lib', 'components']
  const files: string[] = []
  const walk = (dir: string) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e)) files.push(p) } }
  roots.forEach(walk)
  const writers = files.filter(f => /pricePoint\.(create|createMany|update|updateMany|upsert)\b/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(writers.filter(f => !f.startsWith('lib/pricing/engine/')), [], 'penulis price_points di luar mesin')
  // hapus (pembersihan) hanya di tempat pemilik dihapus / mesin
  const deleters = files.filter(f => /pricePoint\.deleteMany/.test(readFileSync(f, 'utf8'))).sort()
  assert.deepEqual(deleters.filter(f => !f.startsWith('lib/pricing/engine/')), [
    'app/api/v1/admin/products/flight/schedules/[id]/route.ts', 'app/api/v1/admin/products/transport/pricing/[id]/route.ts', 'lib/admin/productDelete.ts', 'lib/haji/delete.ts',
  ])
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.pricePoint.deleteMany({ where: { OR: [{ ownerId: { in: [h1.schedule.id, h2.schedule.id, hp.schedule.id, visa.id, haji.id, pkg.id, tour.id] } }, { vendorIds: { array_contains: [vendor.id] } }] } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.package.deleteMany({ where: { id: pkg.id } })
await prisma.tourPackage.deleteMany({ where: { id: tour.id } })
await prisma.hajiProduct.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.visaProduct.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.hotel.deleteMany({ where: { name: { startsWith: `${tag} hotel` } } })
await prisma.roomType.deleteMany({ where: { id: roomType.id } })
await prisma.vendor.deleteMany({ where: { id: vendor.id } })
for (const fn of cleanup) await fn().catch(() => undefined)
await sweepOrphanPricePoints()
await prisma.pricingRule.deleteMany({})
if (savedRules.length) await prisma.pricingRule.createMany({ data: savedRules.map(({ productType, minMarginPercent, roundingIncrement }) => ({ productType, minMarginPercent, roundingIncrement })) })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
