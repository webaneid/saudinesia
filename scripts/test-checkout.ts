// Checkout pelanggan (docs/arsitektur-booking-engine-v2.md §10.5 Fase 11a, §10.6 Fase 11b) terhadap DATABASE SUNGGUHAN:
// alamat kembali sesudah login (`safeNextPath` — daftar putih, tanpa dekode), skema checkout ketat, pemuat produk (harga jual saja, produk nonaktif = tak ada),
// pratinjau = angka yang SAMA dengan pesanan sungguhan dan tidak meninggalkan jejak (booking/kuota), pesan → booking aktif + invoice + jamaah kosong,
// penolakan terarah (visa plus 422 + pelanggaran, belum berharga 422, pilihan paket liar 422, kuota habis 409, tanggal lampau 400), dan penjaga sumber
// (urutan gerbang di kedua route, formulir masuk/daftar menghormati `next`).
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { setManualSell } from '@/lib/pricing/engine/manual'
import { detectSeason } from '@/lib/utils/season'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { afterAuthPath, safeNextPath, withNext } from '@/lib/auth/nextPath'
import { checkoutPath } from '@/lib/checkout/kinds'
import { loadCheckoutProduct } from '@/lib/checkout/options'
import { CheckoutAccountError, placeCheckout } from '@/lib/checkout/place'
import { cartDateRefusal, checkoutDateRefusal } from '@/lib/checkout/dates'
import { bookingFailure, simulateBooking } from '@/lib/booking/simulate'
import { CART_MAX_ITEMS, cartInput, checkoutCartSchema, checkoutInput, checkoutSchema, type CheckoutCart, type CheckoutInput } from '@/lib/validators/checkout'
import { billOf, billSelect } from '@/lib/invoice/bill'
import { addDays, todayInApp } from '@/lib/time'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const tag = `co${Date.now()}`
const U = '00000000-0000-4000-8000-000000000001'

// ── murni: alamat kembali ───────────────────────────────────────────────────────────────────────────────────────────
await t('safeNextPath: hanya halaman checkout berlocale + uuid; semua bentuk lain ditolak tanpa dekode', () => {
  for (const ok of [checkoutPath('id', 'package', U), checkoutPath('en', 'visa', U), checkoutPath('id', 'transport', U), checkoutPath('id', 'haji', U), checkoutPath('id', 'hotel', U), checkoutPath('en', 'tour', U), checkoutPath('id', 'muthowif', U), checkoutPath('id', 'catering', U), checkoutPath('en', 'flight', U)]) assert.equal(safeNextPath(ok), ok, ok)
  for (const bad of [
    '//evil.test', '/\\evil.test', 'https://evil.test/id/checkout/visa?id=' + U, '/id/admin', '/id/dashboard', `/fr/checkout/visa?id=${U}`,
    `/id/checkout/tourPackage?id=${U}`, `/id/checkout/flights?id=${U}`, `/id/checkout/visa?id=${U}&x=1`, `/id/checkout/visa?id=${U}#a`, '/id/checkout/visa?id=nope', `/id/checkout/%76isa?id=${U}`,
    `/id/checkout/visa%3Fid=${U}`, `/id//checkout/visa?id=${U}`, ` /id/checkout/visa?id=${U}`, `/id/checkout/visa?id=${U}\n`, `/ID/checkout/visa?id=${U}`, '',
    `/id/checkout/visa?id=${U}${'a'.repeat(200)}`, null, undefined, 42, [`/id/checkout/visa?id=${U}`],
  ]) assert.equal(safeNextPath(bad), null, JSON.stringify(bad))
  assert.equal(afterAuthPath('id', '//evil.test'), '/id/dashboard')
  assert.equal(afterAuthPath('en', checkoutPath('en', 'haji', U)), checkoutPath('en', 'haji', U))
  assert.equal(withNext('/id/login', '//evil.test'), '/id/login')
  assert.equal(withNext('/id/login', checkoutPath('id', 'visa', U)), `/id/login?next=${encodeURIComponent(checkoutPath('id', 'visa', U))}`)
  // Keranjang (§10.7): persis `/{locale}/keranjang`, tanpa parameter.
  for (const ok of ['/id/keranjang', '/en/keranjang']) assert.equal(safeNextPath(ok), ok)
  for (const bad of ['/fr/keranjang', '/id/keranjang?x=1', '/id/keranjang/', '/id/keranjang#a', '/id//keranjang', '/id/Keranjang', '/keranjang']) assert.equal(safeNextPath(bad), null, bad)
})

await t('checkoutSchema: ketat — harga/total/jamaah/pemilik dari klien ditolak; jenis liar ditolak; batas orang 1..100; visa wajib tanggal', () => {
  const ok = (v: unknown) => checkoutSchema.safeParse(v).success
  assert.equal(ok({ kind: 'haji', hajiProductId: U, numPeople: 2 }), true)
  for (const extra of [{ totalPrice: 1 }, { totalAmount: 1 }, { pilgrims: [] }, { userId: U }, { departureDate: '2090-01-01' }, { status: 'confirmed' }]) {
    assert.equal(ok({ kind: 'haji', hajiProductId: U, numPeople: 1, ...extra }), false, JSON.stringify(extra))
  }
  assert.equal(ok({ kind: 'package', packageId: U, departureDate: '2090-06-05', numPeople: 1, choices: { price: 1 } }), false, 'pilihan paket liar')
  assert.equal(ok({ kind: 'hotel', id: U }), false)
  // Muthowif & Katering (11b-2): jumlah hari TIDAK dari klien (termasuk hari mulai dan selesai); muthowif tanpa memilih orang (K11b-3).
  const M = { kind: 'muthowif', startDate: '2090-06-01', endDate: '2090-06-04', numPeople: 2 }
  assert.equal(ok(M), true); assert.equal(ok({ ...M, endDate: '2090-06-01' }), true, 'satu hari')
  for (const extra of [{ numDays: 1 }, { muthowifId: U }, { totalPrice: 1 }]) assert.equal(ok({ ...M, ...extra }), false, JSON.stringify(extra))
  assert.equal(ok({ ...M, endDate: '2090-05-31' }), false, 'terbalik'); assert.equal(ok({ ...M, endDate: '2090-07-31' }), false, '> 60 hari')
  const mi = checkoutInput(M as CheckoutInput)
  assert.equal(mi.items[0]?.itemType === 'muthowif' && mi.items[0].numDays, 4, 'hari = selisih + 1'); assert.equal(mi.pilgrims.length, 2)
  const C = { kind: 'catering', cateringOptionId: U, startDate: '2090-06-01', endDate: '2090-06-02', numPeople: 3 }
  assert.equal(ok(C), true); assert.equal(ok({ ...C, numDays: 2 }), false); assert.equal(ok({ ...C, endDate: '2090-05-01' }), false)
  const ci = checkoutInput(C as CheckoutInput).items[0]
  assert.equal(ci?.itemType === 'catering' && ci.numDays, 2); assert.equal(checkoutInput(C as CheckoutInput).pilgrims.length, 3)
  // Tiket (11b-2, K11b-1 = b): pulang opsional, berpasangan, tak sebelum berangkat → dua item tiket.
  const F = { kind: 'flight', flightScheduleId: U, departureDate: '2090-06-05', numPassengers: 2 }
  assert.equal(ok(F), true); assert.equal(ok({ ...F, unitPrice: 1 }), false)
  assert.equal(ok({ ...F, returnScheduleId: U }), false, 'pulang tanpa tanggal'); assert.equal(ok({ ...F, returnDate: '2090-06-09' }), false, 'tanggal tanpa jadwal')
  assert.equal(ok({ ...F, returnScheduleId: U, returnDate: '2090-06-04' }), false, 'pulang sebelum berangkat')
  assert.equal(checkoutInput(F as CheckoutInput).items.length, 1)
  const fr = checkoutInput({ ...F, returnScheduleId: U, returnDate: '2090-06-09' } as CheckoutInput)
  assert.deepEqual(fr.items.map(i => i.itemType === 'flight' && [i.departureDate, i.numPassengers]), [['2090-06-05', 2], ['2090-06-09', 2]]); assert.equal(fr.pilgrims.length, 2)
  // Hotel (11b): jumlah malam TIDAK dari klien — dihitung dari tanggal; rentang terbalik/kosong/terlalu panjang ditolak.
  const H = { kind: 'hotel', hotelRoomScheduleId: U, checkIn: '2090-06-05', checkOut: '2090-06-08', numRooms: 1, numGuests: 2 }
  assert.equal(ok(H), true)
  for (const extra of [{ nights: 1 }, { totalPrice: 1 }, { hotelId: U }]) assert.equal(ok({ ...H, ...extra }), false, JSON.stringify(extra))
  assert.equal(ok({ ...H, checkOut: '2090-06-05' }), false, 'nol malam')
  assert.equal(ok({ ...H, checkOut: '2090-06-01' }), false, 'terbalik')
  assert.equal(ok({ ...H, checkOut: '2090-08-05' }), false, '> 60 malam')
  assert.equal(ok({ ...H, numRooms: 0 }), false); assert.equal(ok({ ...H, numRooms: 51 }), false)
  const hi = checkoutInput(H as CheckoutInput)
  assert.equal(hi.items[0]?.itemType === 'hotel' && hi.items[0].nights, 3, 'malam = selisih tanggal'); assert.equal(hi.pilgrims.length, 2)
  // Paket Ziarah (11b): hotel pilihan wajib berpasangan dengan jumlah kamar.
  const T = { kind: 'tour', tourPackageId: U, tourDate: '2090-06-05', numPeople: 2 }
  assert.equal(ok(T), true)
  assert.equal(ok({ ...T, chosenHotelRoomScheduleId: U }), false, 'hotel tanpa jumlah kamar')
  assert.equal(ok({ ...T, chosenHotelNumRooms: 1 }), false, 'jumlah kamar tanpa hotel')
  assert.equal(ok({ ...T, price: 1 }), false)
  assert.equal(ok({ ...T, tourDate: undefined }), false, 'tanggal tur wajib')
  assert.equal(ok({ kind: 'haji', hajiProductId: U, numPeople: 0 }), false)
  assert.equal(ok({ kind: 'haji', hajiProductId: U, numPeople: 101 }), false)
  assert.equal(ok({ kind: 'haji', hajiProductId: U, numPeople: 1.5 }), false)
  assert.equal(ok({ kind: 'visa', visaProductId: U, numPeople: 1 }), false, 'visa tanpa rencana tanggal')
  assert.equal(ok({ kind: 'visa', visaProductId: 'x', numPeople: 1, plannedTravelDate: '2090-01-01' }), false)
  // Haji tanpa visa umroh (H1 = b): jamaah tak pernah membawa visaProductId.
  assert.ok(checkoutInput({ kind: 'haji', hajiProductId: U, numPeople: 3 }).pilgrims.every(p => !('visaProductId' in p)))
})

// ── dunia uji ────────────────────────────────────────────────────────────────────────────────────────────────────────
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]
const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Checkout', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
async function addCost(productType: string, productId: string, component: string, cost: number) {
  await prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent: component, currency: 'IDR', costTiers: flat(cost) as never } })
  await prisma.preferredVendor.create({ data: { productType, productId, costComponent: component, vendorId: vendor.id } }).catch(() => undefined)
}

const visa = await prisma.visaProduct.create({ data: { name: `${tag} Visa Mandiri`, visaType: 'Umroh' } })
await addCost('visa', visa.id, 'visa', 1_000_000); await repriceOwner('visa', visa.id) // jual 1.200.000
const visaPlus = await prisma.visaProduct.create({ data: { name: `${tag} Visa Plus`, visaType: 'Umroh', requiredComponents: [{ type: 'flight' }] } })
await addCost('visa', visaPlus.id, 'visa', 1_000_000); await repriceOwner('visa', visaPlus.id)
const visaOff = await prisma.visaProduct.create({ data: { name: `${tag} Visa Nonaktif`, visaType: 'Umroh', isActive: false } })

const haji = await prisma.hajiProduct.create({ data: { name: `${tag} Haji`, hajiType: 'khusus', year: 2090, totalQuota: 3, departureDate: new Date('2090-05-01'), returnDate: new Date('2090-06-10') } })
await addCost('haji', haji.id, 'paket', 100_000_000); await repriceOwner('haji', haji.id)
const hajiUnpriced = await prisma.hajiProduct.create({ data: { name: `${tag} Haji Tanpa Harga`, hajiType: 'khusus', year: 2090, totalQuota: 10 } })

const trip = await prisma.transportTrip.create({ data: { name: `${tag} bandara`, category: 'airport', origin: 'JED', destination: 'Makkah' } })
const van = await prisma.transportVehicle.create({ data: { name: `${tag} van`, vehicleType: 'van', capacity: 10 } })
const pricing = await prisma.transportPricing.create({ data: { tripId: trip.id, vehicleId: van.id } })
await addCost('transport', pricing.id, 'sewa', 800_000); await repriceOwner('transport', pricing.id) // jual 1.000.000
const quota = await prisma.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date('2090-06-02'), totalSeats: 10 } })
const pastQuota = await prisma.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date('2020-06-02'), totalSeats: 10 } })

const roomType = await prisma.roomType.create({ data: { name: `${tag} double`, defaultCapacity: 2 } })
const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel`, city: 'madinah' } })
const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
const room = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, totalQuota: 50 } })
await addCost('hotel', room.id, 'kamar', 1_000_000); await repriceOwner('hotel', room.id)
// Paket Ziarah (11b): kendaraan termasuk paket (kuota dicari dari tanggal) dan paket berpilihan (kendaraan + hotel).
const quota2 = await prisma.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date('2090-07-01'), totalSeats: 10 } })
const tourIncl = await prisma.tourPackage.create({ data: { name: `${tag} Ziarah Termasuk`, transportTripId: trip.id, transportMode: 'included', includedTransportPricingId: pricing.id, includedTransportPrice: 1_000_000 } })
await addCost('tour_package', tourIncl.id, 'guide', 500_000); await repriceOwner('tour_package', tourIncl.id)
const tourChoice = await prisma.tourPackage.create({ data: { name: `${tag} Ziarah Pilihan`, transportTripId: trip.id, transportMode: 'user_choice', hotelMode: 'user_choice' } })
await prisma.tourPackageHotelOption.create({ data: { tourPackageId: tourChoice.id, hotelRoomScheduleId: room.id, nights: 2 } })
await addCost('tour_package', tourChoice.id, 'guide', 500_000); await repriceOwner('tour_package', tourChoice.id)
const tourUnpriced = await prisma.tourPackage.create({ data: { name: `${tag} Ziarah Tanpa Harga` } })
const hotelOff = await prisma.hotel.create({ data: { name: `${tag} hotel nonaktif`, city: 'makkah', isActive: false } })
// Muthowif (11b-2): layanan tunggal + satu pembimbing (kapasitas harian pool = jumlah kapasitas pembimbing aktif).
let svc = await prisma.muthowifServicePrice.findFirst()
const createdSvc = !svc
svc ??= await prisma.muthowifServicePrice.create({ data: {} })
await prisma.productCost.deleteMany({ where: { productType: 'muthowif', productId: svc.id } })
await prisma.preferredVendor.deleteMany({ where: { productType: 'muthowif', productId: svc.id } })
await addCost('muthowif', svc.id, 'layanan', 100_000); await repriceOwner('muthowif', svc.id)
await prisma.muthowif.create({ data: { name: `${tag} pembimbing`, dailyCapacity: 5 } })
const poolCap = (await prisma.muthowif.aggregate({ where: { isActive: true }, _sum: { dailyCapacity: true } }))._sum.dailyCapacity ?? 0
// Katering (11b-2): harga manual per musim (musim tanggal mulai uji), satu opsi tanpa harga.
const cateringSeason = await detectSeason(new Date('2090-06-10'))
const catering = await prisma.cateringOption.create({ data: { name: `${tag} katering`, boardType: 'full_board', menuStyle: 'asian' } })
await setManualSell({ ownerType: 'catering', ownerId: catering.id, variantKey: `season:${cateringSeason}`, sellIdr: 150_000, byUserId: user.id })
const cateringUnpriced = await prisma.cateringOption.create({ data: { name: `${tag} katering tanpa harga`, boardType: 'half_board', menuStyle: 'arabic' } })
// Tiket (11b-2): berangkat CGK→MED, pulang MED→CGK (rute kebalikan), rute lain CGK→JED, jadwal tanpa harga.
const routeOut = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: `${tag} MED` } })
const routeBack = await prisma.flightRoute.create({ data: { origin: `${tag} med `, destination: `${tag} cgk` } }) // beda huruf/spasi tepi tetap rute kebalikan
const routeOther = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: `${tag} JED` } })
const flightOut = await prisma.flightSchedule.create({ data: { routeId: routeOut.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 10 } })
const flightBack = await prisma.flightSchedule.create({ data: { routeId: routeBack.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-07-31'), totalSeats: 10 } })
const flightOther = await prisma.flightSchedule.create({ data: { routeId: routeOther.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-07-31'), totalSeats: 10 } })
const flightUnpriced = await prisma.flightSchedule.create({ data: { routeId: routeBack.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-07-31'), totalSeats: 10 } })
for (const f of [flightOut, flightBack, flightOther]) { await addCost('flight', f.id, 'tiket', 5_000_000); await repriceOwner('flight', f.id) }
const pkg = await prisma.package.create({ data: { name: `${tag} Paket`, hotelMadinahMode: 'user_choice' } })
await prisma.packageHotelOption.create({ data: { packageId: pkg.id, slot: 'madinah', hotelRoomScheduleId: room.id, nights: 2 } })
await addCost('package', pkg.id, 'handling', 500_000); await repriceOwner('package', pkg.id)

const place = async (c: CheckoutInput) => { return placeCheckout(user.id, { items: [c] }, 3) }
const failOf = async (c: CheckoutInput) => {
  try { await place(c) } catch (e) { return bookingFailure(e) }
  assert.fail('seharusnya ditolak')
}
const bookingsOfUser = () => prisma.booking.count({ where: { userId: user.id } })

const VISA: CheckoutInput = { kind: 'visa', visaProductId: visa.id, numPeople: 2, plannedTravelDate: '2090-06-01' }
const HAJI: CheckoutInput = { kind: 'haji', hajiProductId: haji.id, numPeople: 2 }
const TRANSPORT: CheckoutInput = { kind: 'transport', transportQuotaId: quota.id, numPassengers: 4, pickupDetail: 'GA 980' }
const PACKAGE: CheckoutInput = { kind: 'package', packageId: pkg.id, departureDate: '2090-06-05', numPeople: 2, choices: { hotelMadinahScheduleId: room.id } }
const HOTEL: CheckoutInput = { kind: 'hotel', hotelRoomScheduleId: room.id, checkIn: '2090-06-05', checkOut: '2090-06-08', numRooms: 2, numGuests: 5 }
const TOUR_INCL: CheckoutInput = { kind: 'tour', tourPackageId: tourIncl.id, tourDate: '2090-07-01', numPeople: 3 }
const TOUR_CHOICE: CheckoutInput = { kind: 'tour', tourPackageId: tourChoice.id, tourDate: '2090-06-02', numPeople: 2, transportQuotaId: quota.id, chosenHotelRoomScheduleId: room.id, chosenHotelNumRooms: 1 }
const MUTHOWIF: CheckoutInput = { kind: 'muthowif', startDate: '2090-06-10', endDate: '2090-06-12', numPeople: 2 }
const CATERING: CheckoutInput = { kind: 'catering', cateringOptionId: catering.id, startDate: '2090-06-10', endDate: '2090-06-14', numPeople: 3 }
const FLIGHT: CheckoutInput = { kind: 'flight', flightScheduleId: flightOut.id, departureDate: '2090-06-05', numPassengers: 2, returnScheduleId: flightBack.id, returnDate: '2090-06-20' }
const FLIGHT_ONEWAY: CheckoutInput = { kind: 'flight', flightScheduleId: flightOut.id, departureDate: '2090-06-06', numPassengers: 1 }

await t('pemuat produk: harga JUAL saja (tanpa modal/HPP/vendor); nonaktif = null; Haji/visa/transport/paket memuat pilihannya', async () => {
  for (const [kind, id] of [['visa', visa.id], ['haji', haji.id], ['transport', trip.id], ['package', pkg.id]] as const) {
    const p = await loadCheckoutProduct(kind, id)
    assert.ok(p, kind)
    const json = JSON.stringify(p)
    assert.doesNotMatch(json, /cost|hpp|modal|vendor|margin/i, `${kind}: tak boleh membawa modal`)
  }
  const v = await loadCheckoutProduct('visa', visa.id); assert.ok(v?.kind === 'visa'); assert.equal(v.tiers[0]?.fee, 1_200_000); assert.deepEqual(v.bundledWith, [])
  const vp = await loadCheckoutProduct('visa', visaPlus.id); assert.ok(vp?.kind === 'visa'); assert.ok(vp.bundledWith.length > 0, 'visa plus dijelaskan')
  const h = await loadCheckoutProduct('haji', haji.id); assert.ok(h?.kind === 'haji'); assert.equal(h.seatsLeft, 3); assert.ok(h.price > 0)
  const tr = await loadCheckoutProduct('transport', trip.id); assert.ok(tr?.kind === 'transport')
  assert.deepEqual(tr.slots.map(s => s.quotaId), [quota.id, quota2.id], 'kuota lampau tak ditawarkan'); assert.ok((tr.slots[0]?.price ?? 0) > 0)
  const ho = await loadCheckoutProduct('hotel', hotel.id); assert.ok(ho?.kind === 'hotel')
  assert.deepEqual(ho.schedules.map(x => x.id), [room.id]); assert.ok((ho.schedules[0]?.price ?? 0) > 0); assert.equal(ho.schedules[0]?.capacity, 2)
  const ti = await loadCheckoutProduct('tour', tourIncl.id); assert.ok(ti?.kind === 'tour')
  assert.equal(ti.blocked, null); assert.ok(ti.price > 0); assert.deepEqual(ti.slots.map(x => x.quotaId), [quota.id, quota2.id], 'kuota kendaraan paket, lampau tidak'); assert.ok(ti.slots.every(x => x.price === 0))
  const tc = await loadCheckoutProduct('tour', tourChoice.id); assert.ok(tc?.kind === 'tour')
  assert.ok(tc.slots.length === 2 && tc.slots.every(x => x.price > 0), 'kendaraan pilihan berharga'); assert.deepEqual(tc.hotelOptions.map(x => x.id), [room.id])
  const tu = await loadCheckoutProduct('tour', tourUnpriced.id); assert.ok(tu?.kind === 'tour'); assert.ok(tu.blocked, 'paket belum berharga tak dapat dipesan')
  for (const p of [ho, ti, tc]) assert.doesNotMatch(JSON.stringify(p), /cost|hpp|modal|vendor|margin/i)
  const mu = await loadCheckoutProduct('muthowif', svc!.id); assert.ok(mu?.kind === 'muthowif'); assert.ok(mu.pricePerPersonDay > 0); assert.ok(mu.guides >= 1)
  assert.equal(await loadCheckoutProduct('muthowif', U), null, 'id layanan liar')
  const ca = await loadCheckoutProduct('catering', catering.id); assert.ok(ca?.kind === 'catering'); assert.equal(ca.prices[cateringSeason], 150_000)
  const fl = await loadCheckoutProduct('flight', flightOut.id); assert.ok(fl?.kind === 'flight')
  assert.equal(fl.blocked, null); assert.ok(fl.schedule.price > 0)
  assert.deepEqual(fl.returns.map(r => r.id), [flightBack.id], 'pulang = rute kebalikan berharga; rute lain / tanpa harga tidak')
  const fu = await loadCheckoutProduct('flight', flightUnpriced.id); assert.ok(fu?.kind === 'flight'); assert.ok(fu.blocked, 'jadwal tanpa harga tak dapat dipesan')
  // Nama maskapai = nama vendor tiket yang memang publik di katalog Tiket (lib/catalog/flight.ts) — selain itu tak ada jejak modal/vendor.
  for (const p of [mu, ca, { ...fl, schedule: { ...fl.schedule, airline: null }, returns: fl.returns.map(r => ({ ...r, airline: null })) }]) assert.doesNotMatch(JSON.stringify(p), /cost|hpp|modal|vendor|margin/i)
  assert.equal(fl.schedule.airline, `${tag} vendor`)
  assert.equal(await loadCheckoutProduct('hotel', hotelOff.id), null)
  assert.equal(await loadCheckoutProduct('visa', visaOff.id), null)
  assert.equal(await loadCheckoutProduct('haji', U), null)
})

for (const [label, c] of [['visa', VISA], ['haji', HAJI], ['transport', TRANSPORT], ['paket', PACKAGE], ['hotel', HOTEL], ['ziarah termasuk', TOUR_INCL], ['ziarah pilihan', TOUR_CHOICE], ['muthowif', MUTHOWIF], ['katering', CATERING], ['tiket pulang-pergi', FLIGHT], ['tiket sekali jalan', FLIGHT_ONEWAY]] as const) {
  await t(`${label}: pratinjau = angka pesanan sungguhan; pratinjau tak meninggalkan booking/kuota; pesanan = booking aktif + invoice + jamaah kosong sebanyak orang`, async () => {
    const before = await bookingsOfUser()
    const hajiBefore = await prisma.hajiProduct.findUniqueOrThrow({ where: { id: haji.id }, select: { pendingQuota: true } })
    const quotaBefore = await prisma.transportQuota.findUniqueOrThrow({ where: { id: quota.id }, select: { pendingSeats: true } })
    const p = await simulateBooking({ userId: user.id }, checkoutInput(c), 3)
    assert.equal(await bookingsOfUser(), before, 'pratinjau tidak menyimpan booking')
    assert.deepEqual(await prisma.hajiProduct.findUniqueOrThrow({ where: { id: haji.id }, select: { pendingQuota: true } }), hajiBefore, 'pratinjau tak menahan kuota haji')
    assert.deepEqual(await prisma.transportQuota.findUniqueOrThrow({ where: { id: quota.id }, select: { pendingSeats: true } }), quotaBefore, 'pratinjau tak menahan kursi')
    assert.ok(p.total > 0 && p.lines.length > 0)

    const b = await place(c)
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id }, select: { status: true, userId: true, bookingCode: true, ...billSelect, pilgrims: { select: { fieldValues: true, visaApplication: { select: { visaProductId: true } } } } } })
    assert.equal(row.status, 'active'); assert.equal(row.userId, user.id); assert.doesNotMatch(row.bookingCode, /PRATINJAU/)
    assert.ok((await prisma.invoice.findUnique({ where: { bookingId: b.id }, select: { number: true } }))?.number, 'invoice terbit bersama booking')
    const bill = billOf(row)
    assert.equal(Number(row.totalAmount), p.total, 'subtotal pratinjau = subtotal pesanan'); assert.equal(bill.grandTotal, p.grandTotal, 'tagihan pratinjau = tagihan pesanan')
    const people = c.kind === 'transport' || c.kind === 'flight' ? c.numPassengers : c.kind === 'hotel' ? c.numGuests : c.numPeople
    assert.equal(row.pilgrims.length, people)
    assert.ok(row.pilgrims.every(x => JSON.stringify(x.fieldValues) === '{}'), 'data jamaah diisi SESUDAH terbit (D3)')
    if (c.kind === 'visa') assert.ok(row.pilgrims.every(x => x.visaApplication?.visaProductId === visa.id))
    if (c.kind === 'haji') assert.ok(row.pilgrims.every(x => x.visaApplication === null), 'Haji tanpa visa umroh (H1 = b)')
  })
}

await t('kuota ditahan pending oleh pesanan (haji, transport, kamar hotel, kendaraan ziarah termasuk/pilihan, hotel pilihan ziarah)', async () => {
  assert.equal((await prisma.hajiProduct.findUniqueOrThrow({ where: { id: haji.id } })).pendingQuota, 2)
  assert.equal((await prisma.transportQuota.findUniqueOrThrow({ where: { id: quota.id } })).pendingSeats, 4 + 2, 'transport 4 + ziarah pilihan 2')
  assert.equal((await prisma.transportQuota.findUniqueOrThrow({ where: { id: quota2.id } })).pendingSeats, 3, 'ziarah termasuk: kendaraan paket dari tanggal')
  assert.equal((await prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id: room.id } })).pendingQuota, 2 + 1, 'hotel 2 kamar + hotel pilihan ziarah 1')
  const h = await prisma.bookingHotel.findFirstOrThrow({ where: { booking: { userId: user.id } }, select: { nights: true, numRooms: true, numGuests: true } })
  assert.deepEqual(h, { nights: 3, numRooms: 2, numGuests: 5 }, 'malam dihitung server dari tanggal')
  const tours = await prisma.bookingTourPackage.findMany({ where: { booking: { userId: user.id } }, orderBy: { tourDate: 'asc' }, select: { transportQuotaId: true, chosenHotelRoomScheduleId: true } })
  assert.deepEqual(tours, [{ transportQuotaId: quota.id, chosenHotelRoomScheduleId: room.id }, { transportQuotaId: quota2.id, chosenHotelRoomScheduleId: null }])
})

await t('11b-2 tertahan: kapasitas muthowif per tanggal, kursi tiket berangkat/pulang; hari dihitung server', async () => {
  const pool = await prisma.muthowifPoolAvailability.findMany({ where: { date: { gte: new Date('2090-06-09'), lte: new Date('2090-06-13') } }, orderBy: { date: 'asc' }, select: { pendingCount: true } })
  assert.deepEqual(pool.map(p => p.pendingCount), [2, 2, 2], '10–12 Juni, dua orang per hari')
  assert.equal((await prisma.flightSchedule.findUniqueOrThrow({ where: { id: flightOut.id } })).pendingSeats, 2 + 1, 'pulang-pergi 2 + sekali jalan 1')
  assert.equal((await prisma.flightSchedule.findUniqueOrThrow({ where: { id: flightBack.id } })).pendingSeats, 2)
  assert.equal((await prisma.bookingMuthowif.findFirstOrThrow({ where: { booking: { userId: user.id } } })).numDays, 3)
  assert.equal((await prisma.bookingCatering.findFirstOrThrow({ where: { booking: { userId: user.id } } })).numDays, 5)
  assert.equal(await prisma.bookingFlight.count({ where: { booking: { userId: user.id } } }), 3)
})

await t('penolakan terarah: visa plus 422 + pelanggaran; visa nonaktif/haji tanpa harga 422; pilihan paket di luar daftar 422; kuota habis 409; id tak ada 422 — tanpa booking tersisa', async () => {
  const before = await bookingsOfUser()
  const plus = await failOf({ ...VISA, visaProductId: visaPlus.id } as CheckoutInput)
  assert.equal(plus.status, 422); assert.equal(plus.violations?.[0]?.missing, 'flight')
  assert.equal((await failOf({ ...VISA, visaProductId: visaOff.id } as CheckoutInput)).status, 422)
  assert.equal((await failOf({ kind: 'haji', hajiProductId: hajiUnpriced.id, numPeople: 1 })).status, 422)
  assert.equal((await failOf({ ...PACKAGE, choices: { hotelMadinahScheduleId: U } } as CheckoutInput)).status, 422)
  assert.equal((await failOf({ kind: 'haji', hajiProductId: haji.id, numPeople: 2 })).status, 409, 'sisa kuota haji 1')
  assert.equal((await failOf({ kind: 'haji', hajiProductId: U, numPeople: 1 })).status, 422)
  assert.equal((await failOf({ ...HOTEL, checkIn: '2091-01-02', checkOut: '2091-01-04' } as CheckoutInput)).status, 422, 'di luar periode harga kamar')
  assert.equal((await failOf({ ...HOTEL, numRooms: 50 } as CheckoutInput)).status, 409, 'kamar habis')
  assert.equal((await failOf({ ...TOUR_INCL, tourDate: '2090-08-01' } as CheckoutInput)).status, 422, 'tak ada kendaraan paket di tanggal itu')
  assert.equal((await failOf({ ...TOUR_CHOICE, chosenHotelRoomScheduleId: U } as CheckoutInput)).status, 422, 'hotel di luar opsi paket')
  assert.equal((await failOf({ kind: 'tour', tourPackageId: tourUnpriced.id, tourDate: '2090-06-05', numPeople: 1 })).status, 422, 'paket belum berharga')
  assert.equal((await failOf({ ...MUTHOWIF, numPeople: poolCap - 1 } as CheckoutInput)).status, 409, 'kapasitas pembimbing per tanggal habis')
  assert.equal((await failOf({ ...CATERING, cateringOptionId: cateringUnpriced.id } as CheckoutInput)).status, 422, 'katering belum berharga')
  assert.equal((await failOf({ ...FLIGHT_ONEWAY, departureDate: '2090-07-15' } as CheckoutInput)).status, 422, 'tanggal di luar periode jadwal')
  assert.equal((await failOf({ ...FLIGHT, returnDate: '2090-08-05' } as CheckoutInput)).status, 422, 'tanggal pulang di luar periode jadwal pulang')
  assert.equal((await failOf({ ...FLIGHT_ONEWAY, numPassengers: 8 } as CheckoutInput)).status, 409, 'kursi habis')
  assert.equal((await failOf({ ...FLIGHT_ONEWAY, flightScheduleId: flightUnpriced.id } as CheckoutInput)).status, 422, 'jadwal belum berharga')
  // Pratinjau memakai pemeta yang sama.
  await assert.rejects(simulateBooking({ userId: user.id }, checkoutInput({ ...VISA, visaProductId: visaPlus.id } as CheckoutInput), 3), (e: unknown) => bookingFailure(e).status === 422)
  assert.equal(await bookingsOfUser(), before, 'pesanan yang ditolak tidak meninggalkan booking')
})

// ── keranjang (§10.7, Fase 11c): banyak produk → SATU booking + SATU invoice; satu rombongan; Haji sendiri; satu visa ─────────────────────────
await t('checkoutCartSchema: kosong/lebih dari batas/kunci liar ditolak; Haji tak digabung; dua visa ditolak; jumlah orang berbeda ditolak', () => {
  const ok = (v: unknown) => checkoutCartSchema.safeParse(v).success
  assert.equal(ok({ items: [VISA] }), true)
  assert.equal(ok({ items: [HAJI] }), true, 'Haji sendirian boleh')
  assert.equal(ok({ items: [] }), false)
  assert.equal(ok(VISA), false, 'masukan satu produk tanpa bungkus keranjang')
  assert.equal(ok({ items: [VISA], totalAmount: 1 }), false, 'kunci liar')
  assert.equal(ok({ items: [HAJI, { ...VISA }] }), false, 'Haji + produk lain')
  assert.equal(ok({ items: [VISA, { ...VISA, visaProductId: visaPlus.id }] }), false, 'dua visa')
  assert.equal(ok({ items: [VISA, { ...FLIGHT_ONEWAY, numPassengers: 3 }] }), false, 'jumlah orang berbeda')
  assert.equal(ok({ items: Array.from({ length: CART_MAX_ITEMS + 1 }, () => ({ ...MUTHOWIF })) }), false, 'lebih dari batas')
  assert.equal(ok({ items: Array.from({ length: CART_MAX_ITEMS }, () => ({ ...MUTHOWIF })) }), true)
  assert.deepEqual(cartInput({ items: [VISA] }), checkoutInput(VISA), 'satu entri = checkout satu produk')
})

await t('keranjang: entri bertanggal lampau di posisi mana pun → 400', async () => {
  const yesterday = addDays(todayInApp(), -1)
  assert.equal((await cartDateRefusal({ items: [VISA, { ...CATERING, numPeople: 2, startDate: yesterday }] } as CheckoutCart))?.status, 400)
  assert.equal(await cartDateRefusal({ items: [VISA, { ...CATERING, numPeople: 2 }] } as CheckoutCart), null)
})

await t('keranjang campur: Visa Plus + Tiket + Hotel = SATU booking + SATU invoice; pratinjau = pesanan; visa melekat ke setiap jamaah; aturan visa dinilai atas seluruh keranjang', async () => {
  const before = await bookingsOfUser()
  const PLUS: CheckoutInput = { ...VISA, visaProductId: visaPlus.id } as CheckoutInput
  const lacking = checkoutCartSchema.parse({ items: [PLUS, { ...HOTEL, numRooms: 1, numGuests: 2 }] })
  const miss = await placeCheckout(user.id, lacking, 3).then(() => assert.fail('seharusnya ditolak'), (e: unknown) => bookingFailure(e))
  assert.equal(miss.status, 422); assert.equal(miss.violations?.[0]?.missing, 'flight', 'Visa Plus tanpa tiket di keranjang')
  assert.equal(await bookingsOfUser(), before)

  const cart = checkoutCartSchema.parse({ items: [PLUS, { ...FLIGHT_ONEWAY, numPassengers: 2 }, { ...HOTEL, numRooms: 1, numGuests: 2 }] })
  const p = await simulateBooking({ userId: user.id }, cartInput(cart), 3)
  assert.equal(await bookingsOfUser(), before, 'pratinjau tidak menyimpan')
  const b = await placeCheckout(user.id, cart, 3)
  assert.equal(await bookingsOfUser(), before + 1, 'satu booking')
  const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id }, select: { ...billSelect, pilgrims: { select: { visaApplication: { select: { visaProductId: true } } } }, flights: { select: { id: true } }, hotels: { select: { numGuests: true, numRooms: true } } } })
  assert.equal(await prisma.invoice.count({ where: { bookingId: b.id } }), 1, 'satu invoice')
  assert.equal(Number(row.totalAmount), p.total); assert.equal(billOf(row).grandTotal, p.grandTotal)
  assert.equal(row.pilgrims.length, 2); assert.ok(row.pilgrims.every(x => x.visaApplication?.visaProductId === visaPlus.id))
  assert.equal(row.flights.length, 1); assert.deepEqual(row.hotels, [{ numGuests: 2, numRooms: 1 }])
})

await t('tanggal lampau ditolak 400 (paket, visa, kuota transport lampau); hari ini boleh', async () => {
  const yesterday = addDays(todayInApp(), -1)
  assert.equal((await checkoutDateRefusal({ ...VISA, plannedTravelDate: yesterday } as CheckoutInput))?.status, 400)
  assert.equal((await checkoutDateRefusal({ ...PACKAGE, departureDate: yesterday } as CheckoutInput))?.status, 400)
  assert.equal((await checkoutDateRefusal({ ...TRANSPORT, transportQuotaId: pastQuota.id } as CheckoutInput))?.status, 400)
  assert.equal((await checkoutDateRefusal({ ...HOTEL, checkIn: yesterday, checkOut: todayInApp() } as CheckoutInput))?.status, 400)
  assert.equal((await checkoutDateRefusal({ ...TOUR_INCL, tourDate: yesterday } as CheckoutInput))?.status, 400)
  assert.equal((await checkoutDateRefusal({ ...TOUR_CHOICE, tourDate: '2090-06-03' } as CheckoutInput))?.status, 400, 'tanggal tur ≠ tanggal kendaraan pilihan')
  assert.equal(await checkoutDateRefusal(TOUR_CHOICE), null)
  assert.equal((await checkoutDateRefusal({ ...MUTHOWIF, startDate: yesterday } as CheckoutInput))?.status, 400)
  assert.equal((await checkoutDateRefusal({ ...CATERING, startDate: yesterday } as CheckoutInput))?.status, 400)
  assert.equal((await checkoutDateRefusal({ ...FLIGHT_ONEWAY, departureDate: yesterday } as CheckoutInput))?.status, 400)
  assert.equal((await checkoutDateRefusal({ ...FLIGHT, returnScheduleId: flightOther.id } as CheckoutInput))?.status, 400, 'pulang bukan rute kebalikan')
  assert.equal((await checkoutDateRefusal({ ...FLIGHT, returnScheduleId: flightOut.id } as CheckoutInput))?.status, 400, 'pulang = rute berangkat yang sama')
  assert.equal(await checkoutDateRefusal(FLIGHT), null)
  assert.equal(await checkoutDateRefusal({ ...VISA, plannedTravelDate: todayInApp() } as CheckoutInput), null)
  assert.equal(await checkoutDateRefusal(TRANSPORT), null)
})

await t('akun dibaca ulang di dalam kunci: nonaktif / terhapus sesudah cek sesi → CheckoutAccountError, tanpa booking dan tanpa kuota tertahan (setara publishDraft)', async () => {
  const before = await bookingsOfUser()
  const held = (await prisma.hajiProduct.findUniqueOrThrow({ where: { id: haji.id } })).pendingQuota
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
  await assert.rejects(placeCheckout(user.id, { items: [{ kind: 'haji', hajiProductId: haji.id, numPeople: 1 }] }, 3), CheckoutAccountError)
  await prisma.user.update({ where: { id: user.id }, data: { isActive: true } })
  const gone = await prisma.user.create({ data: { email: `deleted-${tag}@deleted.invalid`, passwordHash: 'x', fullName: 'Terhapus', role: 'pilgrim', isActive: true } })
  await assert.rejects(placeCheckout(gone.id, { items: [{ kind: 'haji', hajiProductId: haji.id, numPeople: 1 }] }, 3), CheckoutAccountError)
  assert.equal(await bookingsOfUser(), before)
  assert.equal((await prisma.hajiProduct.findUniqueOrThrow({ where: { id: haji.id } })).pendingQuota, held, 'kuota tak tertahan')
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
await t('PENJAGA route: sesi → hanya pelanggan → onboardingRefusal → batas laju → Zod → tanggal, SEBELUM mesin; pratinjau tak memberi modal', () => {
  for (const [f, engine] of [['app/api/v1/bookings/route.ts', 'placeCheckout('], ['app/api/v1/bookings/preview/route.ts', 'cartInput(']] as const) { // placeCheckout memanggil cartInput sendiri
    const src = read(f); const post = src.slice(src.indexOf('export async function POST'))
    const order = ['requireSession()', "session.role !== 'pilgrim'", 'onboardingRefusal(', 'consume(policy(', 'checkoutCartSchema.safeParse(', 'cartDateRefusal(', engine].map(s => post.indexOf(s))
    assert.ok(order.every(i => i > 0), `${f}: ${JSON.stringify(order)}`)
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${f}: urutan gerbang`)
  }
  const preview = read('app/api/v1/bookings/preview/route.ts')
  assert.match(preview, /ok\(\{ lines: p\.lines, total: p\.total, tax: p\.tax, taxAdded: p\.taxAdded, grandTotal: p\.grandTotal, dueDays: p\.dueDays \}\)/)
})

await t('PENJAGA alamat kembali: formulir masuk/daftar/Google/lengkapi-data menghormati `next`; halaman checkout mengalihkan dengan withNext', () => {
  for (const f of ['app/[locale]/(auth)/login/LoginForm.tsx', 'app/[locale]/(auth)/register/google/GoogleSignupForm.tsx', 'app/[locale]/(auth)/lengkapi-data/LengkapiDataForm.tsx', 'app/[locale]/(auth)/register/complete/CompleteRegistrationForm.tsx']) {
    const src = read(f)
    assert.doesNotMatch(src, /push\(`\/\$\{locale\}\/dashboard`\)/, `${f}: dasbor tanpa memeriksa next`)
    assert.match(src, /\?\? `\/\$\{locale\}\/dashboard`/, f)
  }
  const page = read('app/[locale]/(public)/checkout/[kind]/page.tsx')
  assert.match(page, /withNext\(`\/\$\{locale\}\/login`, here\)/); assert.match(page, /withNext\(`\/\$\{locale\}\/lengkapi-data`, here\)/)
  assert.match(read('app/api/v1/auth/google/callback/route.ts'), /afterAuthPath\(locale, stateCookie\.next\)/)
  // `next` yang dibawa dibersihkan lagi setiap kali dibaca (cookie/token bisa basi atau dari versi lain).
  assert.match(read('lib/auth/google.ts'), /safeNextPath\(/); assert.match(read('lib/auth/accounts.ts'), /safeNextPath\(/)
})

await t('PENJAGA keranjang: halaman bergerbang sesi (withNext ke login/lengkapi-data); isi perangkat tanpa harga; pesan & pratinjau lewat cartBody; ikon hanya untuk pelanggan; Haji tanpa tombol keranjang', () => {
  const page = read('app/[locale]/(public)/keranjang/page.tsx')
  assert.match(page, /withNext\(`\/\$\{locale\}\/login`, here\)/); assert.match(page, /withNext\(`\/\$\{locale\}\/lengkapi-data`, here\)/)
  const store = read('lib/checkout/cartStore.ts')
  assert.doesNotMatch(store, /price|amount|total|fieldValues|nik|passport/i, 'keranjang perangkat tanpa harga dan data pribadi')
  const view = read('app/[locale]/(public)/keranjang/CartView.tsx')
  assert.match(view, /useCheckoutPreview\(body\)/); assert.match(view, /JSON\.stringify\(body\)/); assert.match(view, /const body = cartBody\(cart\)/)
  assert.match(read('components/shared/Header.tsx'), /session\?\.role === 'pilgrim' && <CartButton/)
  assert.match(read('app/[locale]/(public)/checkout/[kind]/CheckoutForm.tsx'), /product\.kind !== 'haji' && \(/)
})

await t('PENJAGA tombol katalog: Hotel, Paket Ziarah, Muthowif, Katering, Tiket menuju checkoutPath (bukan /register) dan hanya bila berharga', () => {
  for (const [f, kind] of [
    ['app/[locale]/(public)/hotels/[id]/page.tsx', 'hotel'], ['app/[locale]/(public)/tours/page.tsx', 'tour'], ['app/[locale]/(public)/muthowif/[id]/page.tsx', 'muthowif'],
    ['app/[locale]/(public)/catering/page.tsx', 'catering'], ['app/[locale]/(public)/flight/page.tsx', 'flight'],
  ] as const) {
    const src = read(f)
    assert.doesNotMatch(src, /\/register`/, `${f}: tombol pesan ke /register kehilangan produk sesudah login`)
    assert.match(src, new RegExp(`checkoutPath\\(locale, '${kind}'`), f)
  }
})

// ── pembersihan (test-seed-guard sesudahnya butuh DB tanpa jamaah/booking) ───────────────────────────────────────────
await prisma.booking.deleteMany({ where: { userId: { in: [user.id] } } }) // cascade: item, jamaah, visa, snapshot, invoice
const starts = { startsWith: tag }
await prisma.package.deleteMany({ where: { name: starts } })
await prisma.tourPackage.deleteMany({ where: { name: starts } }) // sebelum harga transport & hotel (FK opsi/kendaraan termasuk)
await prisma.visaProduct.deleteMany({ where: { name: starts } })
await prisma.hajiProduct.deleteMany({ where: { name: starts } })
await prisma.transportQuota.deleteMany({ where: { pricing: { trip: { name: starts } } } })
await prisma.transportPricing.deleteMany({ where: { trip: { name: starts } } })
await prisma.transportTrip.deleteMany({ where: { name: starts } })
await prisma.transportVehicle.deleteMany({ where: { name: starts } })
await prisma.hotel.deleteMany({ where: { name: starts } })
await prisma.flightSchedule.deleteMany({ where: { route: { origin: starts } } })
await prisma.flightRoute.deleteMany({ where: { origin: starts } })
await prisma.cateringOption.deleteMany({ where: { name: starts } })
await prisma.muthowif.deleteMany({ where: { name: starts } })
await prisma.muthowifPoolAvailability.deleteMany({ where: { date: { gte: new Date('2090-01-01') } } })
await prisma.priceChange.deleteMany({ where: { byUserId: user.id } })
await prisma.roomType.deleteMany({ where: { name: starts } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
if (createdSvc) await prisma.muthowifServicePrice.delete({ where: { id: svc.id } })
else await repriceOwner('muthowif', svc.id)
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.user.deleteMany({ where: { email: { contains: tag } } })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
assert.equal(await prisma.booking.count({ where: { userId: user.id } }), 0)
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
