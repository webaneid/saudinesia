// Fase 4 harga terpadu (docs/arsitektur-harga-terpadu.md §17): jalur PESAN (`writeBookingItems`) terhadap DATABASE SUNGGUHAN.
// Dibuktikan: harga dibekukan ke price_snapshots per bagian yang dijual (modal·jual·mode·jejak kurs/vendor), `Booking.totalAmount` = Σ snapshot = Σ baris item (I4),
// perubahan harga SESUDAH pesan tidak menggeser snapshot dan UPDATE ditolak DB, harga MANUAL Visa dan Paket Ziarah ditagih (dulu tidak), Visa di luar tier ditolak
// (dulu gratis), pilihan paket di luar opsi ditolak, item yang gagal membatalkan seluruh transaksi, serta penjaga sumber (satu penulis snapshot).
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { repriceOwner, setManualSell, getPricePoint, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { computeTourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'
import { writeBookingItems, type TourPackageResolved } from '@/lib/booking/lineItems'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { detectSeason } from '@/lib/utils/season'
import { createBookingSchema, type CreateBookingInput } from '@/lib/validators/booking'
import { buildInvoiceData, invoiceBookingInclude } from '@/lib/pdf/invoiceData'
import { generateInvoicePdf } from '@/lib/pdf/invoice'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `bs${Date.now()}`
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]
const n = (v: unknown) => (v == null ? null : Number(v))

const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })

const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`.toLowerCase(), countryCode: 'SA' } })
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Snapshot', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const who = user.id
const bookings: string[] = []

async function addCost(productType: string, productId: string, component: string, cost: number, tiers?: unknown) {
  await prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent: component, currency: 'IDR', costTiers: (tiers ?? flat(cost)) as never } })
  await prisma.preferredVendor.create({ data: { productType, productId, costComponent: component, vendorId: vendor.id } })
}

// ── dunia uji ────────────────────────────────────────────────────────────────────────────────────────────────────────
const roomType = await prisma.roomType.create({ data: { name: `${tag} room`, defaultCapacity: 2 } })
async function newSchedule(cost: number | null) {
  const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel ${Math.random()}`, city: 'makkah' } })
  const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
  const schedule = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, totalQuota: 50 } })
  if (cost != null) { await addCost('hotel', schedule.id, 'kamar', cost); await repriceOwner('hotel', schedule.id) }
  return { hotel, schedule }
}
const hotelA = await newSchedule(1_000_000) // jual 1.200.000

const trip = await prisma.transportTrip.create({ data: { name: `${tag} trip`, origin: 'A', destination: 'B' } })
const vehicle = await prisma.transportVehicle.create({ data: { name: `${tag} bus`, vehicleType: 'bus', capacity: 40 } })
const vehicle2 = await prisma.transportVehicle.create({ data: { name: `${tag} van`, vehicleType: 'van', capacity: 10 } })
async function newPricing(veh: string, cost: number | null) {
  const pricing = await prisma.transportPricing.create({ data: { tripId: trip.id, vehicleId: veh } })
  const quota = await prisma.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date('2090-06-02'), totalSeats: 100 } })
  if (cost != null) { await addCost('transport', pricing.id, 'sewa', cost); await repriceOwner('transport', pricing.id) }
  return { pricing, quota }
}
const bus = await newPricing(vehicle.id, 400_000) // jual 500.000 (480.000 → kelipatan 50.000)

let svc = await prisma.muthowifServicePrice.findFirst()
const createdSvc = !svc
svc ??= await prisma.muthowifServicePrice.create({ data: { } })
await prisma.productCost.deleteMany({ where: { productType: 'muthowif', productId: svc.id } })
await prisma.preferredVendor.deleteMany({ where: { productType: 'muthowif', productId: svc.id } })
await addCost('muthowif', svc.id, 'layanan', 100_000)
await repriceOwner('muthowif', svc.id)
const muthowifPoint = (await getPricePoint('muthowif', svc.id))!

const season = await detectSeason(new Date('2090-06-01'))
const catering = await prisma.cateringOption.create({ data: { name: `${tag} katering`, boardType: 'full_board', menuStyle: 'asian' } })
await setManualSell({ ownerType: 'catering', ownerId: catering.id, variantKey: `season:${season}`, sellIdr: 150_000, byUserId: who })

const visa = await prisma.visaProduct.create({ data: { name: `${tag} Umroh`, visaType: 'Umroh' } })
await addCost('visa', visa.id, 'individu', 0, [{ minDays: 1, maxDays: 14, cost: 1_000_000 }, { minDays: 15, maxDays: 30, cost: 2_000_000 }])
await repriceOwner('visa', visa.id) // 1-14: 1.200.000 / 15-30: 2.400.000

const haji = await prisma.hajiProduct.create({ data: { name: `${tag} haji`, hajiType: 'reguler', year: 2090, totalQuota: 50 } })
await addCost('haji', haji.id, 'akomodasi', 1_030_000); await addCost('haji', haji.id, 'transportasi', 1_030_000)
await repriceOwner('haji', haji.id) // 2 × 1.250.000 = 2.500.000

// Paket Ziarah: komponen guide (jual 1.200.000) + hotel included 2 malam × 1 kamar × 1.200.000 + kendaraan included 500.000 → 4.100.000
const tourHotel = await newSchedule(1_000_000)
const tour = await prisma.tourPackage.create({
  data: { name: `${tag} ziarah`, transportTripId: trip.id, transportMode: 'included', includedTransportPricingId: bus.pricing.id, includedTransportPrice: 500_000, hotelMode: 'included' },
})
await prisma.tourPackageHotel.create({ data: { tourPackageId: tour.id, hotelRoomScheduleId: tourHotel.schedule.id, nights: 2, numRooms: 1, pricePerNight: 1_200_000 } })
await addCost('tour_package', tour.id, 'guide', 1_000_000)
await repriceOwner('tour_package', tour.id)

// ── pembantu pesan ───────────────────────────────────────────────────────────────────────────────────────────────────
type Items = CreateBookingInput['items']
type Pilgrims = CreateBookingInput['pilgrims']
const snapCount = () => prisma.priceSnapshot.count()
async function book(items: Items, pilgrims: Pilgrims = [{ fieldValues: {} }], tourResolved: TourPackageResolved[] = []) {
  const data = { departureDate: '2090-06-01', returnDate: '2090-06-10', season, bookingType: 'individual', totalPilgrims: pilgrims.length, items, pilgrims } as unknown as CreateBookingInput
  return prisma.$transaction(async tx => {
    const bk = await tx.booking.create({ data: { bookingCode: `${tag}-${bookings.length}-${Math.random().toString(36).slice(2, 6)}`, userId: user.id, departureDate: new Date('2090-06-01'), returnDate: new Date('2090-06-10'), season, totalAmount: 0 } })
    bookings.push(bk.id)
    const total = await writeBookingItems(tx, bk.id, data, tourResolved)
    await tx.booking.update({ where: { id: bk.id }, data: { totalAmount: total } })
    return { id: bk.id, total }
  }, { isolationLevel: 'Serializable' })
}
const snaps = (bookingId: string) => prisma.priceSnapshot.findMany({ where: { bookingId }, orderBy: [{ itemType: 'asc' }, { lineKey: 'asc' }] })
const sum = (rows: Array<{ totalSellIdr: Prisma.Decimal }>) => rows.reduce((s, r) => s + Number(r.totalSellIdr), 0)
const rejectsNotBookable = async (fn: () => Promise<unknown>, re: RegExp) => {
  await assert.rejects(fn, (e: unknown) => e instanceof ItemNotBookableError && re.test((e as Error).message))
}

// ── per tipe ─────────────────────────────────────────────────────────────────────────────────────────────────────────
await t('Hotel: satu baris — qty = malam × kamar, modal·jual·untung dibekukan, item booking dari bacaan yang sama, total = Σ snapshot', async () => {
  const b = await book([{ itemType: 'hotel', hotelRoomScheduleId: hotelA.schedule.id, checkIn: '2090-06-01', checkOut: '2090-06-04', nights: 3, numRooms: 2 }])
  const [s] = await snaps(b.id)
  assert.equal((await snaps(b.id)).length, 1)
  assert.deepEqual([s!.itemType, s!.lineKey, s!.ownerType, s!.ownerId, s!.unit, n(s!.qty), n(s!.unitSellIdr), n(s!.unitCostIdr), n(s!.totalSellIdr), n(s!.totalCostIdr), s!.mode, s!.itemQty],
    ['hotel', 'main', 'hotel', hotelA.schedule.id, 'room_night', 6, 1_200_000, 1_000_000, 7_200_000, 6_000_000, 'auto', 2])
  assert.match(s!.itemDetail, /01-06-2090 – 04-06-2090 · 3 malam · 2 kamar/)
  const row = await prisma.bookingHotel.findFirstOrThrow({ where: { bookingId: b.id } })
  assert.deepEqual([n(row.pricePerNight), n(row.totalPrice), row.id], [1_200_000, 7_200_000, s!.itemId])
  assert.equal(b.total, 7_200_000)
  assert.equal(n((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).totalAmount), 7_200_000)
})
await t('BEKU: harga naik/diganti manual SESUDAH dipesan → snapshot tetap; UPDATE snapshot ditolak DB', async () => {
  const b = await book([{ itemType: 'hotel', hotelRoomScheduleId: hotelA.schedule.id, checkIn: '2090-06-01', checkOut: '2090-06-02', nights: 1, numRooms: 1 }])
  await setManualSell({ ownerType: 'hotel', ownerId: hotelA.schedule.id, sellIdr: 2_000_000, byUserId: who })
  await addCost('hotel', hotelA.schedule.id, 'ekstra', 500_000); await repriceOwner('hotel', hotelA.schedule.id)
  const [s] = await snaps(b.id)
  assert.deepEqual([n(s!.unitSellIdr), n(s!.unitCostIdr), s!.mode], [1_200_000, 1_000_000, 'auto'], 'jual/modal/mode lama bertahan')
  const b2 = await book([{ itemType: 'hotel', hotelRoomScheduleId: hotelA.schedule.id, checkIn: '2090-06-01', checkOut: '2090-06-02', nights: 1, numRooms: 1 }])
  const [s2] = await snaps(b2.id)
  assert.deepEqual([n(s2!.unitSellIdr), n(s2!.unitCostIdr), s2!.mode], [2_000_000, 1_500_000, 'manual'], 'pesanan baru memakai harga manual + modal baru')
  await assert.rejects(() => prisma.priceSnapshot.update({ where: { id: s!.id }, data: { totalSellIdr: 1 } }), /beku/)
  await assert.rejects(() => prisma.$executeRaw`UPDATE price_snapshots SET "itemLabel" = 'x' WHERE id = ${s!.id}`, /beku/)
  await prisma.pricePoint.deleteMany({ where: { ownerType: 'hotel', ownerId: hotelA.schedule.id } }) // titik dibuang pun snapshot utuh (tanpa FK)
  assert.equal(n((await snaps(b.id))[0]!.unitSellIdr), 1_200_000)
  await prisma.productCost.deleteMany({ where: { productType: 'hotel', productId: hotelA.schedule.id, costComponent: 'ekstra' } })
  await repriceOwner('hotel', hotelA.schedule.id)
})
await t('Transport: satu baris per kendaraan (qty 1, unit vehicle), itemQty = penumpang', async () => {
  const b = await book([{ itemType: 'transport', transportQuotaId: bus.quota.id, numPassengers: 12 }])
  const [s] = await snaps(b.id)
  assert.deepEqual([s!.unit, n(s!.qty), n(s!.unitSellIdr), n(s!.unitCostIdr), n(s!.totalSellIdr), s!.itemQty, s!.ownerId], ['vehicle', 1, 500_000, 400_000, 500_000, 12, bus.pricing.id])
  const row = await prisma.bookingTransport.findFirstOrThrow({ where: { bookingId: b.id } })
  assert.deepEqual([n(row.unitPrice), n(row.totalPrice)], [500_000, 500_000])
})
await t('Muthowif: qty = hari × orang (person_day)', async () => {
  const b = await book([{ itemType: 'muthowif', startDate: '2090-06-01', endDate: '2090-06-04', numDays: 3, numPeople: 4 }])
  const [s] = await snaps(b.id)
  assert.deepEqual([s!.unit, n(s!.qty), n(s!.unitSellIdr), n(s!.totalSellIdr), s!.itemQty], ['person_day', 12, muthowifPoint.sellIdr, muthowifPoint.sellIdr * 12, 4])
  assert.equal(n(s!.unitCostIdr), muthowifPoint.costIdr)
})
await t('Katering: titik harga musim pada tanggal mulai (manual-only: modal belum diketahui = null), qty = hari × orang', async () => {
  const b = await book([{ itemType: 'catering', cateringOptionId: catering.id, startDate: '2090-06-01', endDate: '2090-06-04', numDays: 3, numPeople: 5 }])
  const [s] = await snaps(b.id)
  assert.deepEqual([s!.variantKey, s!.mode, n(s!.unitCostIdr), n(s!.totalCostIdr), n(s!.qty), n(s!.totalSellIdr)], [`season:${season}`, 'manual', null, null, 15, 2_250_000])
  const row = await prisma.bookingCatering.findFirstOrThrow({ where: { bookingId: b.id } })
  assert.equal(n(row.totalPrice), 2_250_000)
})
await t('Haji: satu baris per Komponen Biaya (qty = orang) → Σ = harga × orang', async () => {
  const b = await book([{ itemType: 'haji', hajiProductId: haji.id, numPersons: 2 }])
  const rows = await snaps(b.id)
  assert.equal(rows.length, 2)
  assert.ok(rows.every(r => r.lineKey.startsWith('komponen:') && n(r.qty) === 2 && n(r.unitSellIdr) === 1_250_000 && n(r.unitCostIdr) === 1_030_000 && r.itemQty === 2))
  assert.deepEqual([sum(rows), b.total], [5_000_000, 5_000_000])
  assert.equal(n((await prisma.bookingHaji.findFirstOrThrow({ where: { bookingId: b.id } })).totalPrice), 5_000_000)
})
await t('Haji dengan HARGA MANUAL (2.700.000): ditagih harga manual — selisih jadi baris penyesuaian (Σ baris = jual titik × orang)', async () => {
  await setManualSell({ ownerType: 'haji', ownerId: haji.id, sellIdr: 2_700_000, byUserId: who })
  const b = await book([{ itemType: 'haji', hajiProductId: haji.id, numPersons: 3 }])
  const rows = await snaps(b.id)
  const adj = rows.find(r => r.lineKey === 'penyesuaian')!
  assert.deepEqual([rows.length, n(adj.unitSellIdr), n(adj.qty), adj.mode, adj.unitCostIdr], [3, 200_000, 3, 'manual', null])
  assert.deepEqual([sum(rows), b.total], [8_100_000, 8_100_000])
  await prisma.pricePoint.updateMany({ where: { ownerType: 'haji', ownerId: haji.id }, data: { manualSellIdr: null, manualBy: null, manualAt: null, manualNote: null, sellIdr: 2_500_000 } })
})
await t('Haji belum berharga (titik 0 / tak ada) → ItemNotBookableError; tak ada yang tertulis', async () => {
  const empty = await prisma.hajiProduct.create({ data: { name: `${tag} haji kosong`, hajiType: 'reguler', year: 2090, totalQuota: 5 } })
  await repriceOwner('haji', empty.id)
  const before = await snapCount()
  await rejectsNotBookable(() => book([{ itemType: 'haji', hajiProductId: empty.id, numPersons: 1 }]), /produk haji belum ditetapkan/)
  const zero = await newSchedule(null) // titik harga ADA tetapi bernilai 0 → tetap tidak boleh dijual
  await prisma.pricePoint.create({ data: { ownerType: 'hotel', ownerId: zero.schedule.id, unit: 'room_night', autoSellIdr: 0, sellIdr: 0 } })
  await rejectsNotBookable(() => book([{ itemType: 'hotel', hotelRoomScheduleId: zero.schedule.id, checkIn: '2090-06-01', checkOut: '2090-06-02', nights: 1, numRooms: 1 }]), /kamar hotel belum ditetapkan/)
  const ghost = await prisma.hajiProduct.create({ data: { name: `${tag} haji hantu`, hajiType: 'reguler', year: 2090, totalQuota: 5 } })
  await prisma.pricePoint.deleteMany({ where: { ownerType: 'haji', ownerId: ghost.id } })
  await rejectsNotBookable(() => book([{ itemType: 'haji', hajiProductId: ghost.id, numPersons: 1 }]), /belum ditetapkan/)
  assert.equal(await snapCount(), before)
})

// ── Visa: dua temuan Fase 3 ──────────────────────────────────────────────────────────────────────────────────────────
await t('Visa per tier: durasi 10 hari → tier 1-14 (1.200.000); 20 hari → tier 15-30 (2.400.000); modal/kurs/vendor dibekukan di snapshot', async () => {
  const b = await book([], [{ fieldValues: {}, visaProductId: visa.id, selectedDurationDays: 10 }, { fieldValues: {}, visaProductId: visa.id, selectedDurationDays: 20 }])
  const rows = await snaps(b.id)
  assert.deepEqual(rows.map(r => [r.variantKey, n(r.unitSellIdr), n(r.unitCostIdr), r.itemType, r.itemDetail]).sort(), [
    ['days:1-14', 1_200_000, 1_000_000, 'visa', '10 hari'], ['days:15-30', 2_400_000, 2_000_000, 'visa', '20 hari'],
  ])
  assert.equal(b.total, 3_600_000)
  const apps = await prisma.visaApplication.findMany({ where: { pilgrim: { bookingId: b.id } } })
  assert.ok(rows.every(r => apps.some(a => a.id === r.itemId)), 'itemId = id VisaApplication')
  assert.ok(rows.every(r => !JSON.stringify(r).includes('Uji Snapshot')), 'tanpa data pribadi di snapshot')
})
await t('Visa: HARGA MANUAL tier ditagih (dulu: harga otomatis), mode manual terbekukan; jamaah tanpa visa tidak menyumbang apa pun', async () => {
  await setManualSell({ ownerType: 'visa', ownerId: visa.id, variantKey: 'days:1-14', sellIdr: 1_800_000, byUserId: who })
  const b = await book([], [{ fieldValues: {}, visaProductId: visa.id, selectedDurationDays: 10 }, { fieldValues: {} }])
  const rows = await snaps(b.id)
  assert.deepEqual(rows.map(r => [n(r.unitSellIdr), r.mode]), [[1_800_000, 'manual']])
  assert.equal(b.total, 1_800_000)
})
await t('Visa di luar semua tier / tier berharga 0 → ItemNotBookableError (dulu terjual Rp 0)', async () => {
  const before = await snapCount()
  await rejectsNotBookable(() => book([], [{ fieldValues: {}, visaProductId: visa.id, selectedDurationDays: 60 }]), /60 hari/)
  const bare = await prisma.visaProduct.create({ data: { name: `${tag} visa tanpa harga`, visaType: 'Umroh' } })
  await rejectsNotBookable(() => book([], [{ fieldValues: {}, visaProductId: bare.id, selectedDurationDays: 5 }]), /belum ditetapkan/)
  assert.equal(await snapCount(), before)
})

// ── Paket Ziarah: temuan Fase 3 ──────────────────────────────────────────────────────────────────────────────────────
async function resolveTour(): Promise<TourPackageResolved[]> {
  return [{ breakdown: await computeTourPackageBreakdown(tour.id), transportQuotaId: bus.quota.id }]
}
await t('Paket Ziarah (included): komponen + hotel + kendaraan = satu baris masing-masing, tanpa penyesuaian bila otomatis; modal bagian dari titik harga sub-modul', async () => {
  const b = await book([{ itemType: 'tourPackage', tourPackageId: tour.id, numPeople: 4 }], undefined, await resolveTour())
  const rows = await snaps(b.id)
  const by = Object.fromEntries(rows.map(r => [r.lineKey.split(':')[0]!, r]))
  assert.deepEqual(rows.map(r => r.lineKey.split(':')[0]).sort(), ['hotel-termasuk', 'kendaraan-termasuk', 'komponen'])
  assert.deepEqual([n(by.komponen!.unitSellIdr), n(by.komponen!.unitCostIdr)], [1_200_000, 1_000_000])
  assert.deepEqual([n(by['hotel-termasuk']!.qty), n(by['hotel-termasuk']!.unitSellIdr), n(by['hotel-termasuk']!.unitCostIdr)], [2, 1_200_000, 1_000_000])
  assert.deepEqual([n(by['kendaraan-termasuk']!.unitSellIdr), n(by['kendaraan-termasuk']!.unitCostIdr)], [500_000, 400_000])
  assert.deepEqual([b.total, rows.every(r => r.itemQty === 4)], [4_100_000, true])
  assert.equal(n((await prisma.bookingTourPackage.findFirstOrThrow({ where: { bookingId: b.id } })).totalPrice), 4_100_000)
})
await t('Paket Ziarah: HARGA MANUAL titik harga ditagih (dulu: dihitung ulang dari komponen) — selisih baris penyesuaian', async () => {
  await setManualSell({ ownerType: 'tour_package', ownerId: tour.id, sellIdr: 3_900_000, note: 'promo grup', byUserId: who })
  const b = await book([{ itemType: 'tourPackage', tourPackageId: tour.id, numPeople: 4 }], undefined, await resolveTour())
  const rows = await snaps(b.id)
  const adj = rows.find(r => r.lineKey === 'penyesuaian')!
  assert.deepEqual([n(adj.unitSellIdr), adj.mode, rows.length], [-200_000, 'manual', 4])
  assert.deepEqual([sum(rows), b.total], [3_900_000, 3_900_000])
  assert.equal(n((await prisma.bookingTourPackage.findFirstOrThrow({ where: { bookingId: b.id } })).totalPrice), 3_900_000)
  await prisma.pricePoint.updateMany({ where: { ownerType: 'tour_package', ownerId: tour.id }, data: { manualSellIdr: null, manualBy: null, manualAt: null, manualNote: null, sellIdr: 4_100_000 } })
})
await t('Paket Ziarah user_choice: kendaraan & hotel pilihan = baris sendiri dari titik harga sub-modul; pilihan di luar opsi paket ditolak (dulu bernilai 0)', async () => {
  const van = await newPricing(vehicle2.id, 200_000) // jual 250.000
  const room2 = await newSchedule(1_000_000)        // jual 1.200.000
  const choiceTour = await prisma.tourPackage.create({ data: { name: `${tag} ziarah pilihan`, transportTripId: trip.id, transportMode: 'user_choice', hotelMode: 'user_choice' } })
  await prisma.tourPackageHotelOption.create({ data: { tourPackageId: choiceTour.id, hotelRoomScheduleId: room2.schedule.id, nights: 2 } })
  await addCost('tour_package', choiceTour.id, 'guide', 500_000); await repriceOwner('tour_package', choiceTour.id) // 600.000 → 600.000
  const breakdown = await computeTourPackageBreakdown(choiceTour.id)
  const item = { itemType: 'tourPackage' as const, tourPackageId: choiceTour.id, numPeople: 2, chosenHotelRoomScheduleId: room2.schedule.id, chosenHotelNumRooms: 3 }
  const b = await book([item], undefined, [{ breakdown, transportQuotaId: van.quota.id }])
  const rows = await snaps(b.id)
  assert.deepEqual(rows.map(r => r.lineKey.split(':')[0]).sort(), ['hotel-pilihan', 'kendaraan-pilihan', 'komponen'])
  assert.equal(b.total, 600_000 + 250_000 + 2 * 3 * 1_200_000)
  // kendaraan dari paket/trip lain
  const stranger = await prisma.transportTrip.create({ data: { name: `${tag} trip lain`, origin: 'X', destination: 'Y' } })
  const sp = await prisma.transportPricing.create({ data: { tripId: stranger.id, vehicleId: vehicle.id } })
  const sq = await prisma.transportQuota.create({ data: { pricingId: sp.id, travelDate: new Date('2090-06-02'), totalSeats: 10 } })
  await addCost('transport', sp.id, 'sewa', 100_000); await repriceOwner('transport', sp.id)
  const before = await snapCount()
  await rejectsNotBookable(() => book([item], undefined, [{ breakdown, transportQuotaId: sq.id }]), /Kendaraan yang dipilih/)
  const otherRoom = await newSchedule(500_000)
  await rejectsNotBookable(() => book([{ ...item, chosenHotelRoomScheduleId: otherRoom.schedule.id }], undefined, [{ breakdown, transportQuotaId: van.quota.id }]), /Hotel yang dipilih/)
  assert.equal(await snapCount(), before)
})

// ── invarian & atomik ────────────────────────────────────────────────────────────────────────────────────────────────
await t('campuran semua tipe dalam SATU booking: total = Σ snapshot = Σ baris item + visa (I4); satu item gagal → seluruh booking dibatalkan (tanpa baris yatim)', async () => {
  const items: Items = [
    { itemType: 'hotel', hotelRoomScheduleId: hotelA.schedule.id, checkIn: '2090-06-01', checkOut: '2090-06-03', nights: 2, numRooms: 1 },
    { itemType: 'transport', transportQuotaId: bus.quota.id, numPassengers: 3 },
    { itemType: 'muthowif', startDate: '2090-06-01', endDate: '2090-06-03', numDays: 2, numPeople: 3 },
    { itemType: 'catering', cateringOptionId: catering.id, startDate: '2090-06-01', endDate: '2090-06-03', numDays: 2, numPeople: 3 },
    { itemType: 'tourPackage', tourPackageId: tour.id, numPeople: 3 },
    { itemType: 'haji', hajiProductId: haji.id, numPersons: 1 },
  ]
  const b = await book(items, [{ fieldValues: {}, visaProductId: visa.id, selectedDurationDays: 20 }, { fieldValues: {} }], await resolveTour())
  const rows = await snaps(b.id)
  assert.deepEqual([...new Set(rows.map(r => r.itemType))].sort(), ['catering', 'haji', 'hotel', 'muthowif', 'tourPackage', 'transport', 'visa'])
  const full = await prisma.booking.findUniqueOrThrow({ where: { id: b.id }, include: { hotels: true, transports: true, muthowif: true, catering: true, tourPackages: true, haji: true } })
  const itemRows = [...full.hotels, ...full.transports, ...full.muthowif, ...full.catering, ...full.tourPackages, ...full.haji].reduce((s, r) => s + Number(r.totalPrice), 0)
    + sum(rows.filter(r => r.itemType === 'visa')) // harga visa hanya ada di snapshot (kolom lama VisaApplication sudah dihapus)
  assert.deepEqual([sum(rows), Number(full.totalAmount), itemRows], [b.total, b.total, b.total])
  // semua tersimpan dengan kunci unik (itemType,itemId,lineKey) — dan setiap itemId menunjuk baris yang ada
  assert.equal(new Set(rows.map(r => `${r.itemType}|${r.itemId}|${r.lineKey}`)).size, rows.length)

  const bookingsBefore = await prisma.booking.count({ where: { userId: user.id } })
  const snapsBefore = await snapCount()
  const hotelsBefore = await prisma.bookingHotel.count()
  const unpriced = await newSchedule(null)
  await rejectsNotBookable(() => book([items[0]!, { itemType: 'hotel', hotelRoomScheduleId: unpriced.schedule.id, checkIn: '2090-06-01', checkOut: '2090-06-02', nights: 1, numRooms: 1 }]), /kamar hotel belum ditetapkan/)
  assert.deepEqual([await prisma.booking.count({ where: { userId: user.id } }), await snapCount(), await prisma.bookingHotel.count()], [bookingsBefore, snapsBefore, hotelsBefore], 'transaksi dibatalkan utuh')
})
await t('INVARIAN GLOBAL: untuk SEMUA booking di database, total = Σ snapshot (migrasi mengisi booking lama; jalur baru menulis snapshot)', async () => {
  const rows = await prisma.$queryRaw<Array<{ id: string; total: number; s: number }>>`
    select b.id, b."totalAmount"::float as total, coalesce((select sum("totalSellIdr") from price_snapshots s where s."bookingId" = b.id), 0)::float as s
    from bookings b where b.id = any(${bookings}::text[])`
  assert.ok(rows.length >= 10)
  assert.deepEqual(rows.filter(r => r.total !== r.s), [])
})

// ── audit keamanan Fase 4: kuantitas, periode, pilihan hotel hantu, I5 ────────────────────────────────────────────────
await t('H1: malam/hari harus sama dengan selisih tanggal (nights: 1 untuk 14 malam, check-out ≤ check-in, rentang muthowif/katering terbalik atau tak cocok → 400); data sah lolos', async () => {
  const base = { departureDate: '2090-06-01', returnDate: '2090-06-10', season, bookingType: 'individual', totalPilgrims: 1 }
  const mk = (item: Record<string, unknown>) => createBookingSchema.safeParseAsync({ ...base, items: [item], pilgrims: [{ fieldValues: {} }] })
  const issuePaths = async (item: Record<string, unknown>) => { const r = await mk(item); return r.success ? [] : r.error.issues.map(i => i.path.join('.')) }
  const hotel = { itemType: 'hotel', hotelRoomScheduleId: hotelA.schedule.id, numRooms: 1 }
  assert.ok((await issuePaths({ ...hotel, checkIn: '2090-06-01', checkOut: '2090-06-15', nights: 1 })).includes('items.0.nights'))
  assert.ok((await issuePaths({ ...hotel, checkIn: '2090-06-05', checkOut: '2090-06-05', nights: 1 })).includes('items.0.checkOut'))
  assert.ok((await issuePaths({ ...hotel, checkIn: '2090-06-05', checkOut: '2090-06-01', nights: 1 })).includes('items.0.checkOut'))
  assert.ok(!(await issuePaths({ ...hotel, checkIn: '2090-06-01', checkOut: '2090-06-04', nights: 3 })).some(p => p.startsWith('items.0')))
  const muth = { itemType: 'muthowif', numPeople: 1 }
  assert.ok((await issuePaths({ ...muth, startDate: '2090-06-04', endDate: '2090-06-01', numDays: 1 })).includes('items.0.endDate'))
  assert.ok((await issuePaths({ ...muth, startDate: '2090-06-01', endDate: '2090-06-30', numDays: 1 })).includes('items.0.numDays'))
  assert.ok(!(await issuePaths({ ...muth, startDate: '2090-06-01', endDate: '2090-06-04', numDays: 4 })).some(p => p.startsWith('items.0')))
  assert.ok((await issuePaths({ itemType: 'catering', cateringOptionId: catering.id, startDate: '2090-06-01', endDate: '2090-06-10', numDays: 1, numPeople: 1 })).includes('items.0.numDays'))
})
await t('H1: tanggal menginap di luar periode harga jadwal yang dipilih → ItemNotBookableError (jadwal periode murah tak bisa dipakai untuk tanggal lain)', async () => {
  const before = await snapCount()
  await rejectsNotBookable(() => book([{ itemType: 'hotel', hotelRoomScheduleId: hotelA.schedule.id, checkIn: '2091-02-01', checkOut: '2091-02-03', nights: 2, numRooms: 1 }]), /di luar periode/)
  assert.equal(await snapCount(), before)
})
await t('H1: tanggal transport = tanggal kuota yang ditahan (bukan tanggal berangkat kiriman klien)', async () => {
  const b = await book([{ itemType: 'transport', transportQuotaId: bus.quota.id, numPassengers: 1 }])
  const row = await prisma.bookingTransport.findFirstOrThrow({ where: { bookingId: b.id } })
  assert.equal(row.travelDate.toISOString().slice(0, 10), '2090-06-02')
})
await t('M1: pilihan hotel dari klien pada paket yang BUKAN user_choice tidak disimpan (tak ada kuota hantu saat release/confirm)', async () => {
  const b = await book([{ itemType: 'tourPackage', tourPackageId: tour.id, numPeople: 1, chosenHotelRoomScheduleId: tourHotel.schedule.id, chosenHotelNumRooms: 9999 }], undefined, await resolveTour())
  const row = await prisma.bookingTourPackage.findFirstOrThrow({ where: { bookingId: b.id } })
  assert.deepEqual([row.chosenHotelRoomScheduleId, row.chosenHotelNumRooms], [null, null])
})

// ── invoice dari snapshot ────────────────────────────────────────────────────────────────────────────────────────────
const loadInvoice = async (id: string) => buildInvoiceData(await prisma.booking.findUniqueOrThrow({ where: { id }, include: invoiceBookingInclude }))
await t('INVOICE dari snapshot: satu baris per ITEM (paket = satu baris), jumlah = total, Visa ditempel nama jamaah, hanya JUAL (tanpa modal/untung/jejak), PDF jadi', async () => {
  const b = await book([
    { itemType: 'hotel', hotelRoomScheduleId: hotelA.schedule.id, checkIn: '2090-06-01', checkOut: '2090-06-04', nights: 3, numRooms: 2 },
    { itemType: 'tourPackage', tourPackageId: tour.id, numPeople: 4 },
    { itemType: 'haji', hajiProductId: haji.id, numPersons: 2 },
  ], [{ fieldValues: {}, visaProductId: visa.id, selectedDurationDays: 20 }], await resolveTour())
  const inv = await loadInvoice(b.id)
  assert.deepEqual(inv.lineItems.map(l => [l.qty, l.amount]), [[2, 7_200_000], [4, 4_100_000], [2, 5_000_000], [1, 2_400_000]])
  assert.equal(inv.lineItems[0]!.unitPrice, 3_600_000, 'harga satuan = total ÷ qty')
  assert.match(inv.lineItems[0]!.description, /3 malam · 2 kamar/)
  assert.match(inv.lineItems[3]!.label, /Umroh — Jamaah$/)
  assert.deepEqual([inv.subtotal, inv.totalAmount, inv.balanceDue], [b.total, b.total, b.total])
  assert.doesNotMatch(JSON.stringify(inv), /cost|Cost|modal|margin|untung|hpp|fxRate|vendor/i, 'I5: dokumen pilgrim tanpa modal/untung/jejak')
  const pdf = await generateInvoicePdf(inv)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
})
await t('INVOICE membeku: harga naik/manual sesudah dipesan → invoice sama persis (dulu: baca kolom harga item)', async () => {
  const b = await book([{ itemType: 'hotel', hotelRoomScheduleId: hotelA.schedule.id, checkIn: '2090-06-01', checkOut: '2090-06-02', nights: 1, numRooms: 1 }])
  const before = await loadInvoice(b.id)
  await setManualSell({ ownerType: 'hotel', ownerId: hotelA.schedule.id, sellIdr: 9_999_000, byUserId: who })
  assert.deepEqual(await loadInvoice(b.id), before)
  await prisma.pricePoint.updateMany({ where: { ownerType: 'hotel', ownerId: hotelA.schedule.id }, data: { manualSellIdr: null, manualBy: null, manualAt: null, manualNote: null, sellIdr: 1_200_000 } })
})
await t('INVOICE menolak terbit bila total booking ≠ Σ snapshot (dokumen keuangan tak boleh tidak menjumlah); booking lama tanpa item tetap terbit lewat baris penyesuaian', async () => {
  const b = await book([{ itemType: 'transport', transportQuotaId: bus.quota.id, numPassengers: 1 }])
  await prisma.booking.update({ where: { id: b.id }, data: { totalAmount: 1 } })
  await assert.rejects(() => loadInvoice(b.id), /Σ snapshot/)
  const adj = await prisma.booking.create({ data: { bookingCode: `${tag}-adj`, userId: user.id, departureDate: new Date('2090-06-01'), returnDate: new Date('2090-06-02'), season, totalAmount: 750_000 } })
  bookings.push(adj.id)
  await prisma.priceSnapshot.create({ data: { bookingId: adj.id, itemType: 'booking', itemId: adj.id, lineKey: 'penyesuaian', itemLabel: 'Penyesuaian data lama', itemQty: 1, description: 'Penyesuaian data lama', qty: 1, unit: 'item', unitSellIdr: 750_000, totalSellIdr: 750_000, mode: 'auto' } })
  const inv = await loadInvoice(adj.id)
  assert.deepEqual(inv.lineItems.map(l => [l.label, l.amount]), [['Penyesuaian data lama', 750_000]])
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
const root = new URL('..', import.meta.url).pathname
await t('PENJAGA SUMBER: hanya engine/snapshot.ts menulis price_snapshots; route booking tak menghitung harga sendiri; invoice tak membaca kolom harga item', () => {
  const writers = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'components'))].filter(f => /priceSnapshot\.(create|createMany|update|updateMany|upsert)\b/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(writers.map(f => f.slice(root.length)), ['lib/pricing/engine/snapshot.ts'])
  // I5: VisaApplication (di-include halaman/route pilgrim) tak boleh punya kolom modal/jejak beku — itu hanya ada di price_snapshots (kolom lama dihapus Fase 5)
  const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
  const visaModel = schema.slice(schema.indexOf('model VisaApplication {'), schema.indexOf('@@map("visa_applications")'))
  assert.doesNotMatch(visaModel, /hppSnapshotRupiah|sellPriceSnapshot|exchangeRateIdsUsed|vendorIdsUsed/, 'modal/jejak beku Visa hanya di price_snapshots')
  // I5: modal/untung beku hanya boleh keluar lewat jalur admin yang diperiksa policy (Fase 6). Hari ini TIDAK ADA route/halaman/komponen yang menyentuh snapshot.
  const readers = [...walk(join(root, 'app')), ...walk(join(root, 'components'))].filter(f => /priceSnapshots?\b/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(readers.map(f => f.slice(root.length)), [], 'snapshot (berisi modal) tak boleh dibaca dari app/ atau components/')
  const route = readFileSync(join(root, 'app/api/v1/bookings/route.ts'), 'utf8')
  for (const forbidden of [/requireSellPrice/, /computeSellPrice/, /computeCateringBookingPrice/, /baseTotal|totalForVehicle|hotelChoicePrice/, /\btotalAmount \+=/, /pricePoint\./]) {
    assert.doesNotMatch(route, forbidden, `route booking tidak boleh memuat ${forbidden}`)
  }
  assert.match(route, /writeBookingItems\(tx, bk\.id, data, tourPackageResolved\)/)
  const invoice = readFileSync(join(root, 'lib/pdf/invoiceData.ts'), 'utf8')
  assert.doesNotMatch(invoice, /\.totalPrice|\.unitPrice|\.pricePerNight|sellPriceSnapshot|\.hotels|\.transports|\.tourPackages/, 'invoice hanya membaca price_snapshots')
  const items = readFileSync(join(root, 'lib/booking/lineItems.ts'), 'utf8')
  assert.doesNotMatch(items, /requireSellPrice|computeSellPrice|totalAmount/, 'lineItems tak menghitung harga dengan jalur lama')
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.deleteMany({ where: { id: { in: bookings } } }) // cascade: item, jamaah, visa, snapshot
// tarif muthowif adalah singleton milik tes lain: kembalikan seperti semula
await prisma.productCost.deleteMany({ where: { productType: 'muthowif', productId: svc.id, vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { productType: 'muthowif', productId: svc.id, vendorId: vendor.id } })
if (createdSvc) { await prisma.pricePoint.deleteMany({ where: { ownerType: 'muthowif', ownerId: svc.id } }); await prisma.muthowifServicePrice.delete({ where: { id: svc.id } }) }
// Bersihkan SEMUA fixture (seed-guard menuntut DB uji tanpa data tersisa; FK sub-modul memblokir seed bila ada yang tertinggal).
const starts = { startsWith: tag }
await prisma.tourPackage.deleteMany({ where: { name: starts } }) // cascade: TourPackageHotel / opsi
await prisma.priceChange.deleteMany({ where: { byUserId: who } })
await prisma.transportQuota.deleteMany({ where: { pricing: { trip: { name: starts } } } })
await prisma.transportPricing.deleteMany({ where: { trip: { name: starts } } })
await prisma.transportTrip.deleteMany({ where: { name: starts } })
await prisma.transportVehicle.deleteMany({ where: { name: starts } })
await prisma.hotel.deleteMany({ where: { name: starts } }) // cascade: periode → jadwal kamar
await prisma.roomType.deleteMany({ where: { name: starts } })
await prisma.cateringOption.deleteMany({ where: { name: starts } })
await prisma.visaProduct.deleteMany({ where: { name: starts } })
await prisma.hajiProduct.deleteMany({ where: { name: starts } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.user.delete({ where: { id: user.id } }) // seed-guard menuntut DB uji tanpa jamaah tersisa
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
