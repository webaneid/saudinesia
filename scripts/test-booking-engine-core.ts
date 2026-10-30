// Inti engine booking (docs/arsitektur-booking-engine-v2.md §10.2, Fase 4) terhadap DATABASE SUNGGUHAN:
// aturan visa per produk (tabel nilai murni + konteks DB: item, isi paket, kategori trip, pelonggaran pelanggan), item TIKET (harga × penumpang, tanggal di periode jadwal,
// kursi ditahan/dikonfirmasi/dilepas), item PAKET UMROH per orang (satu baris per komponen × orang, Σ = total, harga manual → baris penyesuaian, pilihan user_choice,
// tanggal & pulang turunan, visa paket untuk jamaah), invoice terurai per komponen, kebijakan pelanggan berjejak, dan penjaga sumber.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { repriceOwner, setManualSell, clearManualSell, getPricePoint, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { writeBookingItems } from '@/lib/booking/lineItems'
import { resolvePackageItem, type PackageResolved } from '@/lib/booking/packageItem'
import { evaluateVisaRules, blockingViolations, type BookingCoverage } from '@/lib/booking/rules'
import { bookingCoverage, visaRuleViolations } from '@/lib/booking/ruleContext'
import { computeTourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'
import { recomputeBookingDates } from '@/lib/booking/dates'
import { cancelBooking } from '@/lib/booking/cancel'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { reserveFlightQuota } from '@/lib/quota'
import { quotaAdapters } from '@/lib/quota/adapters'
import { visaRequiredComponentsSchema, parseRequiredComponents } from '@/lib/validators/visa'
import { createBookingSchema, type CreateBookingInput } from '@/lib/validators/booking'
import { customerPolicySchema } from '@/lib/validators/customers'
import { setCustomerBookingPolicy } from '@/lib/customers/bookingPolicy'
import { buildInvoiceData, invoiceBookingInclude } from '@/lib/pdf/invoiceData'
import { calendarDateOf } from '@/lib/time'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const tag = `ec${Date.now()}`
const n = (v: unknown) => (v == null ? null : Number(v))
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]
const rejectsNotBookable = (fn: () => Promise<unknown>, re: RegExp) => assert.rejects(fn, (e: unknown) => e instanceof ItemNotBookableError && re.test((e as Error).message))

// ── murni: aturan visa ───────────────────────────────────────────────────────────────────────────────────────────────
const none: BookingCoverage = { flight: false, hotel: false, transports: [] }
const V = (requiredComponents: unknown, id = 'v1') => ({ visaProductId: id, visaName: 'Visa Uji', requiredComponents })
await t('aturan visa: tabel nilai — komponen ada/tidak × pelonggaran; tanpa aturan = tanpa pelanggaran; visa yang sama dievaluasi sekali', () => {
  const rule = [{ type: 'flight' }, { type: 'hotel' }]
  assert.deepEqual(evaluateVisaRules([V([])], none, false), [])
  const both = evaluateVisaRules([V(rule)], none, false)
  assert.deepEqual(both.map(v => [v.missing, v.severity]), [['flight', 'error'], ['hotel', 'error']])
  assert.match(both[0]!.message, /Visa Uji mewajibkan tiket pesawat/)
  assert.deepEqual(evaluateVisaRules([V(rule)], { ...none, flight: true }, false).map(v => v.missing), ['hotel'])
  assert.deepEqual(evaluateVisaRules([V(rule)], { ...none, flight: true, hotel: true }, false), [])
  assert.deepEqual(evaluateVisaRules([V(rule)], none, true).map(v => v.severity), ['warning', 'warning'], 'pelonggaran → peringatan')
  assert.equal(blockingViolations(evaluateVisaRules([V(rule)], none, true)).length, 0)
  assert.equal(evaluateVisaRules([V(rule), V(rule)], none, false).length, 2, 'dua jamaah dengan visa sama = satu aturan')
})
await t('aturan visa: transport — tanpa filter = apa pun; kategori ATAU rute tertentu; kategori lain tidak memenuhi', () => {
  const air = { tripId: 'trip-air', category: 'airport' }
  const city = { tripId: 'trip-city', category: 'intercity' }
  assert.deepEqual(evaluateVisaRules([V([{ type: 'transport' }])], { ...none, transports: [city] }, false), [])
  assert.equal(evaluateVisaRules([V([{ type: 'transport' }])], none, false).length, 1)
  assert.deepEqual(evaluateVisaRules([V([{ type: 'transport', categories: ['airport'] }])], { ...none, transports: [air] }, false), [])
  const miss = evaluateVisaRules([V([{ type: 'transport', categories: ['airport'] }])], { ...none, transports: [city] }, false)
  assert.equal(miss.length, 1); assert.match(miss[0]!.message, /kategori airport/)
  assert.deepEqual(evaluateVisaRules([V([{ type: 'transport', tripIds: ['00000000-0000-4000-8000-000000000001'] }])], { ...none, transports: [{ tripId: '00000000-0000-4000-8000-000000000001', category: '' }] }, false), [])
})
await t('aturan visa: data tersimpan tak sah (string lama, tipe liar, duplikat) → SELALU error, walau dilonggarkan (fail-closed)', () => {
  for (const bad of [['hotel'], [{ type: 'kapal' }], [{ type: 'hotel' }, { type: 'hotel' }], 'x', null, [{ type: 'transport', extra: 1 }]]) {
    assert.equal(parseRequiredComponents(bad).invalid, true, JSON.stringify(bad))
    const v = evaluateVisaRules([V(bad)], { flight: true, hotel: true, transports: [] }, true)
    assert.deepEqual(v.map(x => [x.missing, x.severity]), [['rule', 'error']], JSON.stringify(bad))
  }
  assert.equal(visaRequiredComponentsSchema.safeParse([{ type: 'flight' }, { type: 'transport', categories: ['airport'] }]).success, true)
})
await t('validator: item tiket & paket ketat (kunci pilihan liar ditolak, penumpang/orang ≥ 1); kebijakan pelanggan hanya satu kolom', () => {
  const base = { departureDate: '2090-06-01', returnDate: '2090-06-10', season: 'regular', bookingType: 'individual', totalPilgrims: 1, pilgrims: [{ fieldValues: {} }] }
  const item = (i: unknown) => createBookingSchema.innerType().safeParse({ ...base, items: [i] }).success
  const id = '00000000-0000-4000-8000-000000000001'
  assert.equal(item({ itemType: 'flight', flightScheduleId: id, departureDate: '2090-06-01', numPassengers: 1 }), true)
  assert.equal(item({ itemType: 'flight', flightScheduleId: id, departureDate: '2090-06-01', numPassengers: 0 }), false)
  assert.equal(item({ itemType: 'package', packageId: id, departureDate: '2090-06-01', numPeople: 2, choices: { hotelMakkahScheduleId: id } }), true)
  assert.equal(item({ itemType: 'package', packageId: id, departureDate: '2090-06-01', numPeople: 2, choices: { price: 1 } }), false)
  assert.equal(customerPolicySchema.safeParse({ allowVisaWithoutBundle: true }).success, true)
  assert.equal(customerPolicySchema.safeParse({ allowVisaWithoutBundle: true, role: 'superadmin' }).success, false)
})

// ── dunia uji ────────────────────────────────────────────────────────────────────────────────────────────────────────
const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Engine', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const staff = await prisma.user.create({ data: { email: `${tag}-staf@example.test`, passwordHash: 'x', fullName: 'Staf Uji', role: 'admin', isActive: true } })
const bookings: string[] = []
async function addCost(productType: string, productId: string, component: string, cost: number) {
  await prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent: component, currency: 'IDR', costTiers: flat(cost) as never } })
  await prisma.preferredVendor.create({ data: { productType, productId, costComponent: component, vendorId: vendor.id } })
}

const roomType = await prisma.roomType.create({ data: { name: `${tag} quad`, defaultCapacity: 4 } })
const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel`, city: 'makkah' } })
const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
const room = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, totalQuota: 50 } })
await addCost('hotel', room.id, 'kamar', 1_000_000); await repriceOwner('hotel', room.id) // jual 1.200.000
const room2 = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: (await prisma.roomType.create({ data: { name: `${tag} double`, defaultCapacity: 2 } })).id, totalQuota: 50 } })
await addCost('hotel', room2.id, 'kamar', 2_000_000); await repriceOwner('hotel', room2.id) // jual 2.400.000

const route = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: 'MED' } })
const flight = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 10 } })
await addCost('flight', flight.id, 'tiket', 5_000_000); await repriceOwner('flight', flight.id) // jual 6.000.000

const tripAir = await prisma.transportTrip.create({ data: { name: `${tag} bandara`, category: 'airport', origin: 'JED', destination: 'Makkah' } })
const tripCity = await prisma.transportTrip.create({ data: { name: `${tag} antarkota`, category: 'intercity', origin: 'Makkah', destination: 'Madinah' } })
const van = await prisma.transportVehicle.create({ data: { name: `${tag} van`, vehicleType: 'van', capacity: 10 } })
async function quotaOn(tripId: string) {
  const pricing = await prisma.transportPricing.create({ data: { tripId, vehicleId: van.id } })
  await addCost('transport', pricing.id, 'sewa', 800_000); await repriceOwner('transport', pricing.id) // jual 1.000.000 (960.000 → kelipatan 50.000)
  return { pricing, quota: await prisma.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date('2090-06-02'), totalSeats: 100 } }) }
}
const air = await quotaOn(tripAir.id)
const city = await quotaOn(tripCity.id)

const visa = await prisma.visaProduct.create({ data: { name: `${tag} Visa Reguler`, visaType: 'Umroh', requiredComponents: [{ type: 'flight' }, { type: 'hotel' }] } })
await addCost('visa', visa.id, 'visa', 1_000_000); await repriceOwner('visa', visa.id)
const visaAir = await prisma.visaProduct.create({ data: { name: `${tag} Visa Transport`, visaType: 'Umroh', requiredComponents: [{ type: 'transport', categories: ['airport'] }] } })

const pkg = await prisma.package.create({
  data: {
    name: `${tag} Paket Hemat`,
    hotelMakkahMode: 'included', includedHotelMakkahScheduleId: room.id, includedHotelMakkahNights: 3, includedHotelMakkahOccupancy: 2, includedHotelMakkahPrice: 1_200_000,
    hotelMadinahMode: 'user_choice',
    flightMode: 'included', includedFlightScheduleId: flight.id, includedFlightPrice: 6_000_000,
    visaMode: 'included', includedVisaProductId: visa.id, includedVisaPrice: 2_000_000,
    transportMode: 'included', includedTransportPricingId: air.pricing.id, includedTransportPrice: 1_000_000,
  },
})
await prisma.packageHotelOption.create({ data: { packageId: pkg.id, slot: 'madinah', hotelRoomScheduleId: room2.id, nights: 2 } })
await addCost('package', pkg.id, 'handling', 500_000)
await repriceOwner('package', pkg.id)

const data = (items: CreateBookingInput['items'], pilgrims: CreateBookingInput['pilgrims'] = [{ fieldValues: {} }]) =>
  ({ departureDate: '2090-06-01', returnDate: '2090-06-10', season: 'regular', bookingType: 'individual', totalPilgrims: pilgrims.length, items, pilgrims }) as CreateBookingInput
async function book(d: CreateBookingInput, pkgs: PackageResolved[] = []) {
  return prisma.$transaction(async tx => {
    const bk = await tx.booking.create({ data: { bookingCode: `${tag}-${bookings.length}`, userId: user.id, departureDate: null, returnDate: null, season: 'regular', totalAmount: 0 } })
    bookings.push(bk.id)
    const total = await writeBookingItems(tx, bk.id, d, [], pkgs)
    await recomputeBookingDates(tx, bk.id)
    await tx.booking.update({ where: { id: bk.id }, data: { totalAmount: total } })
    return { id: bk.id, total }
  })
}
const snaps = (bookingId: string) => prisma.priceSnapshot.findMany({ where: { bookingId }, orderBy: [{ itemType: 'asc' }, { lineKey: 'asc' }] })
const seats = async () => prisma.flightSchedule.findUniqueOrThrow({ where: { id: flight.id }, select: { pendingSeats: true, bookedSeats: true } })
const pkgItem = (o: Partial<Extract<CreateBookingInput['items'][number], { itemType: 'package' }>> = {}) =>
  ({ itemType: 'package' as const, packageId: pkg.id, departureDate: '2090-06-05', numPeople: 2, choices: {}, ...o })

// ── tiket ────────────────────────────────────────────────────────────────────────────────────────────────────────────
await t('TIKET: harga titik × penumpang, satu baris bermodal; BookingFlight menyimpan tanggal terbang; tanggal acuan booking dari tiket', async () => {
  const b = await book(data([{ itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-07', numPassengers: 3 }]))
  const rows = await snaps(b.id)
  assert.deepEqual(rows.map(r => [r.itemType, r.lineKey, n(r.qty), n(r.unitSellIdr), n(r.unitCostIdr), r.unit]), [['flight', 'main', 3, 6_000_000, 5_000_000, 'person']])
  assert.equal(b.total, 18_000_000)
  const f = await prisma.bookingFlight.findFirstOrThrow({ where: { bookingId: b.id } })
  assert.deepEqual([calendarDateOf(f.departureDate), f.numPassengers, n(f.totalPrice)], ['2090-06-07', 3, 18_000_000])
  const bk = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })
  assert.deepEqual([calendarDateOf(bk.departureDate!), calendarDateOf(bk.returnDate!)], ['2090-06-07', '2090-06-07'])
})
await t('TIKET: tanggal di luar periode jadwal / jadwal nonaktif → 422 (ItemNotBookableError), tak pernah gratis', async () => {
  await rejectsNotBookable(() => book(data([{ itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-07-01', numPassengers: 1 }])), /di luar periode jadwal/)
  await rejectsNotBookable(() => prisma.$transaction(tx => reserveFlightQuota(tx, '00000000-0000-4000-8000-000000000009', 1)), /tidak tersedia/)
  await prisma.flightSchedule.update({ where: { id: flight.id }, data: { isActive: false } })
  await rejectsNotBookable(() => book(data([{ itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-07', numPassengers: 1 }])), /tidak tersedia/)
  await prisma.flightSchedule.update({ where: { id: flight.id }, data: { isActive: true } })
})
await t('KURSI: ditahan (pending) → dikonfirmasi (booked) → dilepas saat batal; kursi habis → "insufficient" (409), tanpa menahan', async () => {
  const before = await seats()
  await prisma.$transaction(tx => reserveFlightQuota(tx, flight.id, 4))
  assert.equal((await seats()).pendingSeats, before.pendingSeats + 4)
  await assert.rejects(() => prisma.$transaction(tx => reserveFlightQuota(tx, flight.id, 7)), /insufficient/)
  assert.equal((await seats()).pendingSeats, before.pendingSeats + 4, 'gagal tak menahan apa pun')
  const row = { id: 'x', bookingId: 'x', flightScheduleId: flight.id, departureDate: new Date(), numPassengers: 4, unitPrice: 0, totalPrice: 0 } as never
  await prisma.$transaction(tx => quotaAdapters.flight.confirm(tx, row))
  assert.deepEqual(await seats(), { pendingSeats: before.pendingSeats, bookedSeats: before.bookedSeats + 4 })
  await prisma.flightSchedule.update({ where: { id: flight.id }, data: { pendingSeats: before.pendingSeats, bookedSeats: before.bookedSeats } })
})

// ── paket umroh ──────────────────────────────────────────────────────────────────────────────────────────────────────
await t('PAKET: titik harga PER ORANG = komponen + hotel (malam × harga kamar ÷ isi) + kendaraan (÷ kapasitas) + tiket + visa', async () => {
  const p = await getPricePoint('package', pkg.id)
  // handling 600.000 + hotel 3×1.200.000÷2 = 1.800.000 + kendaraan 1.000.000÷10 = 100.000 + tiket 6.000.000 + visa 2.000.000
  assert.equal(p?.sellIdr, 10_500_000)
})
await t('PAKET: satu baris per komponen × jumlah orang (P2), Σ = jual titik × orang, modal per orang dibekukan; pulang = berangkat + malam hotel', async () => {
  const r = await resolvePackageItem(pkgItem())
  const b = await book(data([pkgItem()]), [r])
  const rows = await snaps(b.id)
  const byKey = Object.fromEntries(rows.map(x => [x.lineKey, x]))
  assert.deepEqual(Object.keys(byKey).sort(), ['hotel-makkah-termasuk', 'kendaraan-termasuk', 'komponen:' + (await prisma.productCost.findFirstOrThrow({ where: { productType: 'package', productId: pkg.id } })).id, 'tiket-termasuk', 'visa-termasuk'].sort())
  for (const x of rows) assert.equal(n(x.qty), 2, x.lineKey)
  assert.deepEqual([n(byKey['hotel-makkah-termasuk']!.unitSellIdr), n(byKey['hotel-makkah-termasuk']!.unitCostIdr)], [1_800_000, 1_500_000])
  assert.deepEqual([n(byKey['kendaraan-termasuk']!.unitSellIdr), n(byKey['kendaraan-termasuk']!.unitCostIdr)], [100_000, 80_000])
  assert.deepEqual([n(byKey['tiket-termasuk']!.unitSellIdr), n(byKey['tiket-termasuk']!.unitCostIdr)], [6_000_000, 5_000_000])
  assert.equal(b.total, 21_000_000)
  const bp = await prisma.bookingPackage.findFirstOrThrow({ where: { bookingId: b.id } })
  assert.deepEqual([calendarDateOf(bp.departureDate), calendarDateOf(bp.returnDate), bp.numPeople, bp.flightScheduleId, n(bp.totalPrice)], ['2090-06-05', '2090-06-08', 2, flight.id, 21_000_000])
  const bk = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })
  assert.deepEqual([calendarDateOf(bk.departureDate!), calendarDateOf(bk.returnDate!), n(bk.totalAmount)], ['2090-06-05', '2090-06-08', 21_000_000])
})
await t('PAKET: harga MANUAL per orang menang lewat baris "Penyesuaian harga paket" × orang; Σ tetap = manual × orang', async () => {
  await setManualSell({ ownerType: 'package', ownerId: pkg.id, sellIdr: 11_000_000, byUserId: staff.id })
  const b = await book(data([pkgItem()]), [await resolvePackageItem(pkgItem())])
  const adj = (await snaps(b.id)).find(x => x.lineKey === 'penyesuaian')!
  assert.deepEqual([n(adj.qty), n(adj.unitSellIdr)], [2, 500_000])
  assert.equal(b.total, 22_000_000)
  await clearManualSell({ ownerType: 'package', ownerId: pkg.id, byUserId: staff.id })
})
await t('PAKET: pilihan user_choice (hotel Madinah) = baris per orang (malam × harga kamar ÷ isi tipe kamar); pulang ikut malam pilihan', async () => {
  const item = pkgItem({ choices: { hotelMadinahScheduleId: room2.id } })
  const r = await resolvePackageItem(item)
  assert.equal(r.returnDate, '2090-06-10')
  const b = await book(data([item]), [r])
  const line = (await snaps(b.id)).find(x => x.lineKey === 'hotel-madinah-pilihan')!
  assert.deepEqual([n(line.qty), n(line.unitSellIdr), n(line.unitCostIdr)], [2, 2_400_000, 2_000_000]) // 2 malam × 2.400.000 ÷ 2
  assert.equal(b.total, 21_000_000 + 4_800_000)
})
await t('PAKET: pilihan di luar daftar opsi / untuk komponen bukan user_choice / tanggal di luar periode tiket / paket nonaktif / muthowif pilihan → 422', async () => {
  await rejectsNotBookable(() => resolvePackageItem(pkgItem({ choices: { hotelMadinahScheduleId: room.id } })), /tidak tersedia untuk paket ini/)
  await rejectsNotBookable(() => resolvePackageItem(pkgItem({ choices: { hotelMakkahScheduleId: room.id } })), /tidak berlaku untuk paket ini/)
  await rejectsNotBookable(() => resolvePackageItem(pkgItem({ departureDate: '2090-07-15' })), /periode tiket pesawat/)
  await prisma.package.update({ where: { id: pkg.id }, data: { muthowifMode: 'user_choice' } })
  await rejectsNotBookable(() => resolvePackageItem(pkgItem()), /muthowif pilihan/)
  await prisma.package.update({ where: { id: pkg.id }, data: { muthowifMode: 'none', isActive: false } })
  await rejectsNotBookable(() => resolvePackageItem(pkgItem()), /tidak tersedia/)
  await prisma.package.update({ where: { id: pkg.id }, data: { isActive: true } })
})
await t('PAKET: jamaah TANPA visa sendiri mendapat VisaApplication visa paket TANPA baris harga visa terpisah; jamaah ber-visa sendiri tetap ditagih visanya', async () => {
  const item = pkgItem({ numPeople: 1 })
  const b = await book(data([item], [{ fieldValues: {} }, { fieldValues: {}, visaProductId: visa.id, selectedDurationDays: 9 }]), [await resolvePackageItem(item)])
  const apps = await prisma.visaApplication.findMany({ where: { pilgrim: { bookingId: b.id } }, select: { visaProductId: true } })
  assert.deepEqual(apps.map(a => a.visaProductId), [visa.id, visa.id])
  assert.equal((await snaps(b.id)).filter(x => x.itemType === 'visa').length, 1, 'hanya visa jamaah kedua yang ditagih terpisah')
})
await t('PAKET + batal: kursi paket dilepas lewat packageAdapter (cancelBooking); konfirmasi memindahkan ke booked', async () => {
  const before = await seats()
  const item = pkgItem()
  const r = await resolvePackageItem(item)
  const b = await book(data([item]), [r])
  await prisma.$transaction(tx => reserveFlightQuota(tx, flight.id, 2)) // POST /bookings menahan kursi paket sebelum item ditulis
  assert.equal((await seats()).pendingSeats, before.pendingSeats + 2)
  await prisma.$transaction(async tx => cancelBooking(tx, await tx.booking.findUniqueOrThrow({ where: { id: b.id }, include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true } }), 'uji'))
  assert.equal((await seats()).pendingSeats, before.pendingSeats, 'kursi paket dilepas')
  const bp = await prisma.bookingPackage.findFirstOrThrow({ where: { bookingId: b.id } })
  await prisma.$transaction(tx => reserveFlightQuota(tx, flight.id, 2))
  await prisma.$transaction(tx => quotaAdapters.package.confirm(tx, bp))
  assert.deepEqual(await seats(), { pendingSeats: before.pendingSeats, bookedSeats: before.bookedSeats + 2 })
  await prisma.flightSchedule.update({ where: { id: flight.id }, data: { pendingSeats: before.pendingSeats, bookedSeats: before.bookedSeats } })
})
await t('INVOICE: paket terurai satu baris per komponen (label = komponen, qty = orang), item lain tetap satu baris; Σ = total', async () => {
  const item = pkgItem()
  const b = await book(data([item, { itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-20', numPassengers: 1 }]), [await resolvePackageItem(item)])
  const full = await prisma.booking.findUniqueOrThrow({ where: { id: b.id }, include: invoiceBookingInclude })
  const inv = await buildInvoiceData(full)
  const labels = inv.lineItems.map(l => l.label)
  assert.ok(labels.some(l => l.startsWith('Hotel Makkah:')) && labels.some(l => l.startsWith('Tiket pesawat')) && labels.includes(`${tag} Visa Reguler`), labels.join(' | '))
  assert.ok(inv.lineItems.filter(l => l.description.startsWith(`${tag} Paket Hemat`)).every(l => l.qty === 2))
  assert.equal(labels.filter(l => l.startsWith('Tiket ') && !l.startsWith('Tiket pesawat')).length, 1, 'item tiket mandiri tetap satu baris')
  assert.equal(Math.round(inv.lineItems.reduce((s, l) => s + l.amount, 0)), 21_000_000 + 6_000_000)
})

// ── aturan visa dengan konteks DB ────────────────────────────────────────────────────────────────────────────────────
const visaPilgrim = (id = visa.id) => [{ fieldValues: {}, visaProductId: id }]
await t('ATURAN (DB): visa wajib tiket+hotel — tanpa apa-apa → 2 error; tiket+hotel mandiri → lolos; Paket berisi keduanya → lolos (P: paket memenuhi aturan)', async () => {
  assert.deepEqual((await visaRuleViolations(data([], visaPilgrim()), user.id, [], [])).map(v => [v.missing, v.severity]), [['flight', 'error'], ['hotel', 'error']])
  const items: CreateBookingInput['items'] = [
    { itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-05', numPassengers: 1 },
    { itemType: 'hotel', hotelRoomScheduleId: room.id, checkIn: '2090-06-05', checkOut: '2090-06-08', nights: 3, numRooms: 1 },
  ]
  assert.deepEqual(await visaRuleViolations(data(items, visaPilgrim()), user.id, [], []), [])
  assert.deepEqual(await visaRuleViolations(data([pkgItem()], visaPilgrim()), user.id, [await resolvePackageItem(pkgItem())], []), [])
})
await t('ATURAN (DB): Paket dengan tiket user_choice yang BELUM dipilih tidak memenuhi; transport kategori airport dipenuhi trip bandara, bukan antarkota (item atau isi paket)', async () => {
  const noFlight = await prisma.package.create({ data: { name: `${tag} Paket Tanpa Tiket`, flightMode: 'user_choice', flightRouteId: route.id, hotelMakkahMode: 'included', includedHotelMakkahScheduleId: room.id, includedHotelMakkahNights: 2, includedHotelMakkahOccupancy: 4, includedHotelMakkahPrice: 1_200_000 } })
  await repriceOwner('package', noFlight.id)
  const item = { ...pkgItem(), packageId: noFlight.id }
  const r = await resolvePackageItem(item)
  assert.deepEqual((await visaRuleViolations(data([item], visaPilgrim()), user.id, [r], [])).map(v => v.missing), ['flight'])
  const chosen = { ...item, choices: { flightScheduleId: flight.id } }
  assert.deepEqual(await visaRuleViolations(data([chosen], visaPilgrim()), user.id, [await resolvePackageItem(chosen)], []), [])

  const tr = (quotaId: string) => ({ itemType: 'transport' as const, transportQuotaId: quotaId, numPassengers: 1 })
  assert.deepEqual(await visaRuleViolations(data([tr(air.quota.id)], visaPilgrim(visaAir.id)), user.id, [], []), [])
  assert.equal((await visaRuleViolations(data([tr(city.quota.id)], visaPilgrim(visaAir.id)), user.id, [], [])).length, 1)
  assert.deepEqual(await visaRuleViolations(data([pkgItem()], visaPilgrim(visaAir.id)), user.id, [await resolvePackageItem(pkgItem())], []), [], 'kendaraan paket = trip bandara')
})
await t('ATURAN (DB): pelonggaran dibaca dari akun PEMESAN — allowVisaWithoutBundle → peringatan, booking lolos; visa paket sendiri tidak dievaluasi', async () => {
  await prisma.user.update({ where: { id: user.id }, data: { allowVisaWithoutBundle: true } })
  const v = await visaRuleViolations(data([], visaPilgrim()), user.id, [], [])
  assert.deepEqual([v.length, blockingViolations(v).length], [2, 0])
  await prisma.user.update({ where: { id: user.id }, data: { allowVisaWithoutBundle: false } })
  assert.deepEqual(await visaRuleViolations(data([pkgItem()]), user.id, [await resolvePackageItem(pkgItem())], []), [], 'jamaah tanpa visa sendiri: tak ada aturan yang dievaluasi')
})

await t('SEC-124: hotel Paket Ziarah hanya memenuhi aturan bila BENAR-BENAR ditagih — id hotel sembarang / tanpa jumlah kamar / mode bukan pilihan tidak dihitung', async () => {
  const tour = await prisma.tourPackage.create({ data: { name: `${tag} ziarah`, hotelMode: 'user_choice' } })
  await prisma.tourPackageHotelOption.create({ data: { tourPackageId: tour.id, hotelRoomScheduleId: room.id, nights: 2 } })
  const tours = [{ breakdown: await computeTourPackageBreakdown(tour.id), transportQuotaId: null }]
  const tp = (o: Record<string, unknown>) => data([{ itemType: 'tourPackage', tourPackageId: tour.id, numPeople: 1, ...o } as CreateBookingInput['items'][number]])
  assert.equal((await bookingCoverage(tp({ chosenHotelRoomScheduleId: '00000000-0000-4000-8000-0000000000ff' }), [], tours)).hotel, false, 'id palsu tanpa kamar')
  assert.equal((await bookingCoverage(tp({ chosenHotelRoomScheduleId: room.id }), [], tours)).hotel, false, 'opsi sah tapi tanpa jumlah kamar = tak ditagih')
  assert.equal((await bookingCoverage(tp({ chosenHotelRoomScheduleId: '00000000-0000-4000-8000-0000000000ff', chosenHotelNumRooms: 1 }), [], tours)).hotel, false, 'di luar daftar opsi')
  assert.equal((await bookingCoverage(tp({ chosenHotelRoomScheduleId: room.id, chosenHotelNumRooms: 1 }), [], tours)).hotel, true, 'kontrol positif')
})
await t('SEC-125: visa yang DIPILIH di Paket dievaluasi aturannya (paket serba-pilihan); visa INCLUDED paket tidak', async () => {
  const choice = await prisma.package.create({ data: { name: `${tag} Paket Pilihan`, visaMode: 'user_choice', flightMode: 'user_choice', flightRouteId: route.id } })
  await prisma.packageVisaOption.create({ data: { packageId: choice.id, visaProductId: visa.id } })
  await addCost('package', choice.id, 'layanan', 100_000); await repriceOwner('package', choice.id)
  const item = { ...pkgItem(), packageId: choice.id, choices: { visaProductId: visa.id } }
  const v = await visaRuleViolations(data([item]), user.id, [await resolvePackageItem(item)], [])
  assert.deepEqual(v.map(x => x.missing).sort(), ['flight', 'hotel'])
  const withFlight = { ...item, choices: { visaProductId: visa.id, flightScheduleId: flight.id } }
  assert.deepEqual((await visaRuleViolations(data([withFlight]), user.id, [await resolvePackageItem(withFlight)], [])).map(x => x.missing), ['hotel'])
})
await t('SEC-126: tanggal menginap paket harus di periode harga hotel paket (included maupun pilihan); kontrol positif di dalam periode', async () => {
  const hotelOnly = await prisma.package.create({ data: { name: `${tag} Paket Hotel`, hotelMakkahMode: 'included', includedHotelMakkahScheduleId: room.id, includedHotelMakkahNights: 3, includedHotelMakkahOccupancy: 2, includedHotelMakkahPrice: 1_200_000 } })
  await repriceOwner('package', hotelOnly.id)
  const at = (d: string) => resolvePackageItem({ ...pkgItem(), packageId: hotelOnly.id, departureDate: d })
  await rejectsNotBookable(() => at('2091-01-05'), /periode harga/)
  await rejectsNotBookable(() => at('2090-12-30'), /periode harga/) // pulang 2091-01-02 melewati akhir periode
  assert.equal((await at('2090-12-28')).returnDate, '2090-12-31')
})
await t('SEC-127: visa paket (included) yang NONAKTIF → 422, tak bisa menjadi pengajuan visa gratis', async () => {
  await prisma.visaProduct.update({ where: { id: visa.id }, data: { isActive: false } })
  await rejectsNotBookable(() => resolvePackageItem(pkgItem()), /Visa paket ini tidak tersedia/)
  await prisma.visaProduct.update({ where: { id: visa.id }, data: { isActive: true } })
})

// ── kebijakan pelanggan ──────────────────────────────────────────────────────────────────────────────────────────────
await t('KEBIJAKAN PELANGGAN: ubah → kolom + satu jejak audit (sebelum/sesudah, staf); nilai sama → tanpa jejak; staf/akun terhapus ditolak', async () => {
  const audits = () => prisma.settingsAudit.findMany({ where: { entity: 'customer_policy', entityId: user.id } })
  const r1 = await setCustomerBookingPolicy(user.id, { allowVisaWithoutBundle: true }, staff.id)
  assert.deepEqual(r1, { ok: true, changed: true })
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).allowVisaWithoutBundle, true)
  const a = await audits()
  assert.equal(a.length, 1); assert.deepEqual([a[0]!.staffId, a[0]!.summary], [staff.id, { allowVisaWithoutBundle: [false, true] }])
  assert.deepEqual(await setCustomerBookingPolicy(user.id, { allowVisaWithoutBundle: true }, staff.id), { ok: true, changed: false })
  assert.equal((await audits()).length, 1)
  assert.equal((await setCustomerBookingPolicy(staff.id, { allowVisaWithoutBundle: true }, staff.id)).ok, false, 'bukan pelanggan → 404')
  await setCustomerBookingPolicy(user.id, { allowVisaWithoutBundle: false }, staff.id)
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
await t('PENJAGA: aturan visa hanya di rules.ts (validator tak lagi membaca requiredComponents); route POST menolak 422 + meta.violations SEBELUM transaksi; kursi tiket/paket ditahan', () => {
  assert.ok(!read('lib/validators/booking.ts').includes('requiredComponents'), 'superRefine lama dihapus')
  const route = read('app/api/v1/bookings/route.ts')
  assert.ok(route.indexOf('blockingViolations(') < route.indexOf('prisma.$transaction'), 'aturan dievaluasi sebelum kuota ditahan')
  assert.match(route, /status: 422/); assert.match(route, /meta: \{ violations \}/)
  assert.match(route, /case 'flight':\s*\n\s*await reserveFlightQuota\(tx, item\.flightScheduleId, item\.numPassengers\)/)
  assert.match(route, /if \(r\.flightScheduleId\) await reserveFlightQuota\(tx, r\.flightScheduleId, item\.numPeople\)/)
  for (const f of ['lib/booking/cancel.ts', 'lib/payments/process.ts']) {
    const s = read(f); assert.ok(s.includes('quotaAdapters.flight.') && s.includes('quotaAdapters.package.'), f)
  }
  for (const f of ['lib/booking/expire.ts', 'app/api/v1/bookings/[id]/route.ts', 'lib/payments/process.ts']) assert.match(read(f), /flights: true, packages: true/, f)
  assert.match(read('app/api/v1/admin/products/visa/[id]/route.ts'), /requiredComponents: visaRequiredComponentsSchema\.optional\(\)/)
  assert.match(read('app/api/v1/admin/customers/[id]/policy/route.ts'), /requireCustomerManage\(\)/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.deleteMany({ where: { id: { in: bookings } } }) // cascade: item, jamaah, visa, snapshot
const starts = { startsWith: tag }
await prisma.package.deleteMany({ where: { name: starts } })
await prisma.tourPackage.deleteMany({ where: { name: starts } })
await prisma.visaProduct.deleteMany({ where: { name: starts } })
await prisma.transportQuota.deleteMany({ where: { pricing: { trip: { name: starts } } } })
await prisma.transportPricing.deleteMany({ where: { trip: { name: starts } } })
await prisma.transportTrip.deleteMany({ where: { name: starts } })
await prisma.transportVehicle.deleteMany({ where: { name: starts } })
await prisma.flightSchedule.deleteMany({ where: { routeId: route.id } })
await prisma.flightRoute.delete({ where: { id: route.id } })
await prisma.hotel.deleteMany({ where: { name: starts } })
await prisma.roomType.deleteMany({ where: { name: starts } })
await prisma.priceChange.deleteMany({ where: { byUserId: staff.id } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.$executeRawUnsafe(`ALTER TABLE settings_audit DISABLE TRIGGER settings_audit_no_change`) // pembersihan uji: jejak append-only milik akun uji
await prisma.settingsAudit.deleteMany({ where: { entity: 'customer_policy', entityId: user.id } })
await prisma.$executeRawUnsafe(`ALTER TABLE settings_audit ENABLE TRIGGER settings_audit_no_change`)
await prisma.user.deleteMany({ where: { id: { in: [user.id, staff.id] } } })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
