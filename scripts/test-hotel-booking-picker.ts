import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { bookingCatalog } from '@/lib/booking/catalog'
import { writeBookingItems } from '@/lib/booking/lineItems'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { hotelsOf, noPeriodMessage, resolveHotelSchedule, roomsOf, type HotelScheduleOpt } from '@/lib/booking/hotelPick'
import type { CreateBookingInput } from '@/lib/validators/booking'
import { assertThrowawayDb } from './lib/testDb'

// Pemilih hotel di form booking admin (docs/arsitektur-hotel.md §12.6): Jenis → Hotel → Kamar, periode otomatis dari tanggal; katalog hanya harga jual
// dan hanya kamar/periode/hotel aktif; mesin pesan menolak kamar yang dinonaktifkan.
await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const tag = `hb${Date.now()}`

// ── murni ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const O = (id: string, hotelId: string, roomTypeId: string, from: string, to: string, price: number, capacity = 4): HotelScheduleOpt =>
  ({ id, hotelId, hotelName: hotelId === 'h1' ? 'Zamzam' : 'Anjum', city: 'makkah', stars: hotelId === 'h1' ? 5 : null, roomTypeId, roomType: roomTypeId === 'q' ? 'Quad' : 'Double', capacity, from, to, roomsLeft: 5, price })
const opts = [
  O('s1', 'h1', 'q', '2090-01-01', '2090-01-31', 1_000_000), O('s2', 'h1', 'q', '2090-02-01', '2090-02-28', 1_500_000),
  O('s3', 'h1', 'd', '2090-01-01', '2090-01-31', 2_000_000, 2), O('s4', 'h2', 'q', '2090-01-01', '2090-03-31', 900_000),
]
await t('MURNI: hotel unik urut nama; kamar unik urut kapasitas dengan rentang harga jual lintas periode', () => {
  assert.deepEqual(hotelsOf(opts).map(h => [h.id, h.name, h.stars]), [['h2', 'Anjum', null], ['h1', 'Zamzam', 5]])
  assert.deepEqual(roomsOf(opts, 'h1').map(r => [r.id, r.capacity, r.minPrice, r.maxPrice]), [['d', 2, 2_000_000, 2_000_000], ['q', 4, 1_000_000, 1_500_000]])
  assert.deepEqual(roomsOf(opts, 'tak-ada'), [])
})
await t('MURNI: periode dipilih dari tanggal — tercakup penuh (termasuk check-out = akhir periode); lintas dua periode / di luar → no_period dengan daftar periode; belum lengkap → incomplete', () => {
  const r = (ci: string, co: string, h = 'h1', rt = 'q') => resolveHotelSchedule(opts, h, rt, ci, co)
  const ok = (x: ReturnType<typeof r>) => (x.ok ? x.schedule.id : x.reason)
  assert.equal(ok(r('2090-01-05', '2090-01-10')), 's1')
  assert.equal(ok(r('2090-01-01', '2090-01-31')), 's1', 'batas inklusif — aturan sama dengan mesin pesan')
  assert.equal(ok(r('2090-02-03', '2090-02-05')), 's2')
  assert.equal(ok(r('2090-01-30', '2090-02-02')), 'no_period', 'lintas periode tidak terpecah')
  assert.equal(ok(r('2090-04-01', '2090-04-03')), 'no_period')
  assert.equal(ok(r('2090-01-05', '2090-01-10', 'h1', 'd')), 's3', 'kamar lain → jadwal lain')
  assert.equal(ok(r('2090-01-05', '2090-01-10', 'h2')), 's4', 'hotel lain → jadwal lain')
  for (const x of [r('', '2090-01-10'), r('2090-01-10', '2090-01-10'), r('2090-01-10', '2090-01-05'), resolveHotelSchedule(opts, 'h1', '', '2090-01-05', '2090-01-10')]) assert.equal(ok(x), 'incomplete')
  const miss = r('2090-01-30', '2090-02-02')
  assert.ok(!miss.ok); assert.deepEqual(miss.periods, [{ from: '2090-01-01', to: '2090-01-31' }, { from: '2090-02-01', to: '2090-02-28' }])
  assert.match(noPeriodMessage(miss.periods), /Periode tersedia: .*2090.*; .*2090/)
  assert.equal(noPeriodMessage([]), 'Belum ada harga untuk kamar ini')
})

// ── dunia uji ────────────────────────────────────────────────────────────────────────────────────────────────────────
const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const roomType = await prisma.roomType.create({ data: { name: `${tag} quad`, defaultCapacity: 4 } })
const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel`, city: 'makkah', stars: 4 } })
async function schedule(start: string, end: string, cost: number, o: { periodActive?: boolean; active?: boolean } = {}) {
  const period = await prisma.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date(start), periodEnd: new Date(end), isActive: o.periodActive ?? true } })
  const s = await prisma.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, totalQuota: 10, isActive: o.active ?? true } })
  await prisma.productCost.create({ data: { productType: 'hotel', productId: s.id, vendorId: vendor.id, costComponent: 'kamar', currency: 'IDR', costTiers: [{ minDays: 0, maxDays: 9999, cost }] as never } })
  await prisma.preferredVendor.create({ data: { productType: 'hotel', productId: s.id, costComponent: 'kamar', vendorId: vendor.id } })
  await repriceOwner('hotel', s.id)
  return { period, s }
}
const jan = await schedule('2090-01-01', '2090-01-31', 1_000_000) // jual 1.200.000
const feb = await schedule('2090-02-01', '2090-02-28', 1_500_000) // jual 1.800.000
const offPeriod = await schedule('2090-03-01', '2090-03-31', 1_000_000, { periodActive: false })
const offRoom = await schedule('2090-04-01', '2090-04-30', 1_000_000, { active: false })
const mine = async () => ((await bookingCatalog('hotel')) as HotelScheduleOpt[]).filter(o => o.hotelId === hotel.id)

await t('KATALOG: satu baris per jadwal aktif (periode nonaktif & kamar nonaktif TIDAK ada); hotelId/roomTypeId/bintang ikut; HANYA harga jual', async () => {
  const rows = await mine()
  assert.deepEqual(rows.map(r => r.id).sort(), [jan.s.id, feb.s.id].sort())
  const j = rows.find(r => r.id === jan.s.id)!
  assert.deepEqual([j.hotelId, j.roomTypeId, j.stars, j.capacity, j.from, j.to, j.price, j.roomsLeft], [hotel.id, roomType.id, 4, 4, '2090-01-01', '2090-01-31', 1_200_000, 10])
  const keys = Object.keys(j).join(',')
  assert.doesNotMatch(keys, /cost|hpp|modal|margin|vendor/i, `kunci katalog: ${keys}`)
  const res = resolveHotelSchedule(rows, hotel.id, roomType.id, '2090-02-10', '2090-02-12')
  assert.ok(res.ok && res.schedule.id === feb.s.id && res.schedule.price === 1_800_000, 'periode Februari dipilih otomatis')
})

const bookings: string[] = []
const hotelItem = (scheduleId: string, checkIn: string, checkOut: string, nights: number) =>
  ({ itemType: 'hotel' as const, hotelRoomScheduleId: scheduleId, checkIn, checkOut, nights, numRooms: 1 })
const book = (item: ReturnType<typeof hotelItem>) => prisma.$transaction(async tx => {
  const bk = await tx.booking.create({ data: { bookingCode: `${tag}-${bookings.length}`, userId: user.id, departureDate: null, returnDate: null, season: 'regular', totalAmount: 0 } })
  bookings.push(bk.id)
  const d = { departureDate: checkInOf(item), returnDate: item.checkOut, season: 'regular', bookingType: 'individual', totalPilgrims: 1, items: [item], pilgrims: [{ fieldValues: {} }] } as CreateBookingInput
  return writeBookingItems(tx, bk.id, d, [], [])
})
const checkInOf = (i: ReturnType<typeof hotelItem>) => i.checkIn
const notBookable = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: unknown) => e instanceof ItemNotBookableError && re.test((e as Error).message))

await t('MESIN: jadwal aktif terjual (malam × harga jual); kamar / periode / hotel NONAKTIF ditolak 422 walau id dikirim langsung', async () => {
  assert.equal(await book(hotelItem(jan.s.id, '2090-01-05', '2090-01-08', 3)), 3_600_000)
  await notBookable(book(hotelItem(offRoom.s.id, '2090-04-05', '2090-04-07', 2)), /tidak dijual lagi/)
  await notBookable(book(hotelItem(offPeriod.s.id, '2090-03-05', '2090-03-07', 2)), /tidak dijual lagi/)
  await prisma.hotel.update({ where: { id: hotel.id }, data: { isActive: false } })
  try {
    await notBookable(book(hotelItem(jan.s.id, '2090-01-05', '2090-01-08', 3)), /tidak dijual lagi/)
    assert.equal((await mine()).length, 0, 'hotel nonaktif hilang dari katalog')
  } finally { await prisma.hotel.update({ where: { id: hotel.id }, data: { isActive: true } }) }
  await notBookable(book(hotelItem(jan.s.id, '2090-01-30', '2090-02-02', 3)), /periode|tanggal/i) // lintas periode tetap ditolak server
})

await t('PENJAGA SUMBER: baris hotel memakai resolver bersama (periode otomatis), tanpa batas tanggal dari periode; kolom harga berlabel "Harga jual"', () => {
  const rows = read('app/[locale]/admin/(protected)/bookings/drafts/[id]/ItemRows.tsx')
  assert.match(rows, /from '@\/lib\/booking\/hotelPick'/)
  assert.match(rows, /resolveHotelSchedule\(catalog\.hotel/)
  assert.doesNotMatch(rows, /hotel\?\.from, hotel\?\.to/, 'tanggal tak dibatasi satu periode')
  assert.match(rows, /<span className="text-right">Harga jual<\/span>/)
  assert.doesNotMatch(read('lib/booking/hotelPick.ts'), /@\/lib\/db|prisma/, 'murni (aman di klien)')
  assert.match(read('lib/booking/catalog.ts'), /period: \{ isActive: true, periodEnd: \{ gte: today \}, hotel: \{ isActive: true \} \}/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.deleteMany({ where: { id: { in: bookings } } })
await prisma.hotel.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.roomType.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.user.delete({ where: { id: user.id } })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
