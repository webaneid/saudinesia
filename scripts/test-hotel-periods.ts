import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { setManualSell } from '@/lib/pricing/engine/manual'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { createPeriod, deletePeriod, duplicatePeriod, HotelPeriodError, removeRoom, savePeriodPrices, updatePeriod } from '@/lib/hotels/periods'
import { periodPricesSchema, periodUpdateSchema } from '@/lib/validators/hotelPeriod'
import { assertThrowawayDb } from './lib/testDb'

// Periode harga hotel (docs/arsitektur-hotel.md §12): edit · hapus-aman · duplikat · hapus tipe kamar · simpan harga transaksional · cakupan hotel.
await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const tag = `hp${Date.now()}`
async function rejects(p: Promise<unknown>, status: number, re?: RegExp) {
  const e = await p.then(() => null, (x: unknown) => x)
  assert.ok(e instanceof HotelPeriodError, `harus HotelPeriodError, dapat ${String(e)}`)
  assert.equal(e.status, status, e.message)
  if (re) assert.match(e.message, re)
}

const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
const staff = await prisma.user.create({ data: { email: `${tag}-staf@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'superadmin', isActive: true } })
const customer = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Pelanggan', role: 'pilgrim', isActive: true } })
const single = await prisma.roomType.create({ data: { name: `${tag} single`, defaultCapacity: 1 } })
const quad = await prisma.roomType.create({ data: { name: `${tag} quad`, defaultCapacity: 4 } })
const hotel = await prisma.hotel.create({ data: { name: `${tag} hotel`, city: 'madinah' } })
const other = await prisma.hotel.create({ data: { name: `${tag} lain`, city: 'makkah' } })
const IDR = (cost: number, roomTypeId: string, totalQuota = 10) => ({ roomTypeId, cost, totalQuota })

const { id: p1 } = await createPeriod(hotel.id, { periodStart: '2090-01-01', periodEnd: '2090-01-31' })
const schedOf = async (periodId: string) => prisma.hotelRoomSchedule.findMany({ where: { periodId }, orderBy: { roomType: { defaultCapacity: 'asc' } } })
const sell = async (id: string) => Number((await prisma.pricePoint.findFirstOrThrow({ where: { ownerType: 'hotel', ownerId: id } })).sellIdr)

await t('BUAT + SIMPAN HARGA: satu transaksi, vendor sama untuk semua kamar, harga jual dari mesin; tumpang tindih / akhir < mulai DITOLAK', async () => {
  await savePeriodPrices(hotel.id, p1, { vendorId: vendor.id, currency: 'IDR', rooms: [IDR(1_000_000, single.id, 5), IDR(2_000_000, quad.id, 8)] })
  const [s, q] = await schedOf(p1)
  assert.deepEqual([await sell(s!.id), await sell(q!.id)], [1_200_000, 2_400_000])
  assert.equal(new Set((await prisma.productCost.findMany({ where: { productId: { in: [s!.id, q!.id] } } })).map(c => c.vendorId)).size, 1)
  await rejects(createPeriod(hotel.id, { periodStart: '2090-01-20', periodEnd: '2090-02-10' }), 409, /Tumpang tindih/)
  await rejects(createPeriod(hotel.id, { periodStart: '2090-03-10', periodEnd: '2090-03-01' }), 400)
  // gagal di tengah (tipe kamar tak ada) → tak ada yang tersimpan sebagian
  const before = await prisma.productCost.count({ where: { vendorId: vendor.id } })
  await savePeriodPrices(hotel.id, p1, { vendorId: vendor.id, currency: 'IDR', rooms: [IDR(9_000_000, single.id), IDR(1, '00000000-0000-0000-0000-000000000000')] }).catch(() => null)
  assert.equal(await prisma.productCost.count({ where: { vendorId: vendor.id } }), before)
  assert.equal(await sell(s!.id), 1_200_000, 'harga lama utuh (rollback)')
  assert.equal(periodPricesSchema.safeParse({ vendorId: vendor.id, currency: 'IDR', rooms: [IDR(1, single.id), IDR(2, single.id)] }).success, false, 'tipe kamar ganda')
  assert.equal(periodUpdateSchema.safeParse({ periodStart: '2090-01-01', hotelId: other.id }).success, false, '.strict()')
})

await t('CAKUPAN HOTEL: periode hotel lain → 404 untuk ubah / hapus / duplikat / hapus kamar / simpan harga', async () => {
  const [s] = await schedOf(p1)
  await rejects(updatePeriod(other.id, p1, { periodEnd: '2090-02-05' }), 404)
  await rejects(deletePeriod(other.id, p1), 404)
  await rejects(duplicatePeriod(other.id, p1, { periodStart: '2090-05-01', periodEnd: '2090-05-31' }, staff.id), 404)
  await rejects(removeRoom(other.id, p1, s!.id), 404)
  await rejects(savePeriodPrices(other.id, p1, { vendorId: vendor.id, currency: 'IDR', rooms: [IDR(5, single.id)] }), 404)
  assert.equal(await prisma.hotelPricePeriod.count({ where: { hotelId: other.id } }), 0)
})

await t('DUPLIKAT: kamar aktif, kuota (terpakai 0), biaya + vendor, harga jual MANUAL disalin dengan jejak; tanggal tumpang tindih DITOLAK', async () => {
  const [s, q] = await schedOf(p1)
  await prisma.hotelRoomSchedule.update({ where: { id: s!.id }, data: { pendingQuota: 2, bookedQuota: 1 } })
  await setManualSell({ ownerType: 'hotel', ownerId: q!.id, byUserId: staff.id, sellIdr: 2_750_000, note: 'nego' })
  await rejects(duplicatePeriod(hotel.id, p1, { periodStart: '2090-01-31', periodEnd: '2090-02-28' }, staff.id), 409)
  const { id: p2 } = await duplicatePeriod(hotel.id, p1, { periodStart: '2090-02-01', periodEnd: '2090-02-28' }, staff.id)
  const [s2, q2] = await schedOf(p2)
  assert.deepEqual([s2!.roomTypeId, s2!.totalQuota, s2!.pendingQuota, s2!.bookedQuota, q2!.totalQuota], [single.id, 5, 0, 0, 8])
  const cost = await prisma.productCost.findFirstOrThrow({ where: { productType: 'hotel', productId: s2!.id } })
  assert.deepEqual([cost.vendorId, cost.currency, cost.costTiers], [vendor.id, 'IDR', [{ minDays: 0, maxDays: 9999, cost: 1_000_000 }]])
  assert.equal(await prisma.preferredVendor.count({ where: { productType: 'hotel', productId: { in: [s2!.id, q2!.id] } } }), 2)
  assert.deepEqual([await sell(s2!.id), await sell(q2!.id)], [1_200_000, 2_750_000], 'jual otomatis + jual manual tersalin')
  const change = await prisma.priceChange.findFirst({ where: { ownerType: 'hotel', ownerId: q2!.id }, orderBy: { at: 'desc' } })
  assert.match(change?.note ?? '', /Disalin dari periode/)
  // sumber tidak berubah
  assert.deepEqual([await sell(s!.id), await sell(q!.id)], [1_200_000, 2_750_000])
})

await t('UBAH TANGGAL: tumpang tindih DITOLAK; booking hidup di luar rentang baru DITOLAK; booking batal tak menghalangi; nonaktif → aktif dicek tumpang tindih', async () => {
  const [s] = await schedOf(p1)
  await rejects(updatePeriod(hotel.id, p1, { periodEnd: '2090-02-02' }), 409, /Tumpang tindih/)
  await rejects(updatePeriod(hotel.id, p1, { periodStart: '2090-01-10', periodEnd: '2090-01-05' }), 400)
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-1`, userId: customer.id, season: 'regular', totalAmount: 0, status: 'active' } })
  await prisma.bookingHotel.create({ data: { bookingId: b.id, hotelRoomScheduleId: s!.id, checkIn: new Date('2090-01-03'), checkOut: new Date('2090-01-06'), nights: 3, numGuests: 1, pricePerNight: 0, totalPrice: 0 } })
  await rejects(updatePeriod(hotel.id, p1, { periodStart: '2090-01-05' }), 409, /1 booking/)
  await updatePeriod(hotel.id, p1, { periodStart: '2090-01-02', periodEnd: '2090-01-30' }) // masih mencakup 3–6 Jan
  await prisma.booking.update({ where: { id: b.id }, data: { status: 'cancelled' } })
  await updatePeriod(hotel.id, p1, { periodStart: '2090-01-05' }) // booking batal tak menghalangi
  const p = await prisma.hotelPricePeriod.findUniqueOrThrow({ where: { id: p1 } })
  assert.deepEqual([p.periodStart.toISOString(), p.periodEnd.toISOString()], ['2090-01-05T00:00:00.000Z', '2090-01-30T00:00:00.000Z'], 'tanggal kalender ditulis tanpa geser zona')
})

await t('HAPUS: dirujuk booking → NONAKTIF (bisa diaktifkan lagi); tak dirujuk → terhapus beserta biaya, vendor, dan titik harga (tanpa yatim)', async () => {
  const r1 = await deletePeriod(hotel.id, p1)
  assert.equal(r1.deleted, false)
  assert.equal((await prisma.hotelPricePeriod.findUniqueOrThrow({ where: { id: p1 } })).isActive, false)
  await updatePeriod(hotel.id, p1, { isActive: true })
  const p2 = (await prisma.hotelPricePeriod.findFirstOrThrow({ where: { hotelId: hotel.id, periodStart: new Date('2090-02-01') } })).id
  const ids = (await schedOf(p2)).map(s => s.id)
  assert.deepEqual(await deletePeriod(hotel.id, p2), { deleted: true })
  assert.equal(await prisma.hotelPricePeriod.count({ where: { id: p2 } }), 0)
  const left = await Promise.all([
    prisma.productCost.count({ where: { productType: 'hotel', productId: { in: ids } } }),
    prisma.preferredVendor.count({ where: { productType: 'hotel', productId: { in: ids } } }),
    prisma.pricePoint.count({ where: { ownerType: 'hotel', ownerId: { in: ids } } }),
  ])
  assert.deepEqual(left, [0, 0, 0])
})

await t('HAPUS TIPE KAMAR: dirujuk → nonaktif; tak dirujuk → terhapus bersih; kuota di bawah terpakai DITOLAK', async () => {
  const [s, q] = await schedOf(p1)
  await rejects(savePeriodPrices(hotel.id, p1, { vendorId: vendor.id, currency: 'IDR', rooms: [IDR(1_000_000, single.id, 2)] }), 409, /tidak boleh di bawah 3/)
  assert.equal((await removeRoom(hotel.id, p1, s!.id)).deleted, false)
  assert.equal((await prisma.hotelRoomSchedule.findUniqueOrThrow({ where: { id: s!.id } })).isActive, false)
  assert.deepEqual(await removeRoom(hotel.id, p1, q!.id), { deleted: true })
  assert.equal(await prisma.pricePoint.count({ where: { ownerType: 'hotel', ownerId: q!.id } }), 0)
  await rejects(removeRoom(hotel.id, p1, q!.id), 404)
})

await t('PENJAGA: route periode memakai satu penulis (lib/hotels/periods.ts), memvalidasi `.strict()`, dan tak menulis tabel periode/jadwal sendiri', () => {
  const dir = 'app/api/v1/admin/products/hotels/[id]/periods'
  for (const f of ['route.ts', '[periodId]/route.ts', '[periodId]/prices/route.ts', '[periodId]/duplicate/route.ts', '[periodId]/rooms/[scheduleId]/route.ts']) {
    const src = read(`${dir}/${f}`)
    assert.ok(!/hotelPricePeriod\.(create|update|delete)|hotelRoomSchedule\.(create|update|upsert|delete)|productCost\.(create|update)/.test(src), `${f} menulis langsung`)
    assert.match(src, /from '@\/lib\/hotels\/periods'/)
  }
  assert.match(read(`${dir}/[periodId]/duplicate/route.ts`), /requireSuperAdmin\(\)/, 'menyalin HPP = superadmin')
  assert.match(read(`${dir}/[periodId]/prices/route.ts`), /requireSuperAdmin\(\)/)
  assert.match(read('lib/hotels/periods.ts'), /dropPolymorphic\(tx, 'hotel'/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.deleteMany({ where: { userId: customer.id } })
await prisma.hotel.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.roomType.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.user.deleteMany({ where: { id: { in: [customer.id, staff.id] } } })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
