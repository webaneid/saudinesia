import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { deleteTransportPricing, deleteTransportTrip } from '@/lib/admin/productDelete'
import { bookingCatalog } from '@/lib/booking/catalog'
import { deleteQuota, listQuotas, openQuotas, TransportQuotaError, updateQuotaSeats } from '@/lib/transport/quotas'
import { addDays, todayInApp } from '@/lib/time'
import { openQuotasSchema, updateQuotaSchema } from '@/lib/validators/transportQuota'
import { assertThrowawayDb } from './lib/testDb'

// Kuota tanggal transport dari admin + hapus-aman harga kendaraan dan trip (docs/arsitektur-transportasi.md §10).
await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
async function rejects(p: Promise<unknown>, status: number, re?: RegExp) {
  const e = await p.then(() => null, (x: unknown) => x)
  assert.ok(e instanceof TransportQuotaError, `harus TransportQuotaError, dapat ${String(e)}`)
  assert.equal(e.status, status, e.message)
  if (re) assert.match(e.message, re)
}

const tag = `tq${Date.now()}`
const today = todayInApp()
const day = (n: number) => addDays(today, n)
const vehicle = await prisma.transportVehicle.create({ data: { name: `${tag} bus`, vehicleType: 'bus', capacity: 45 } })
const makeTrip = (suffix: string) => prisma.transportTrip.create({ data: { name: `${tag} ${suffix}`, origin: 'A', destination: 'B' } })
const trip = await makeTrip('utama')
const pricing = await prisma.transportPricing.create({ data: { tripId: trip.id, vehicleId: vehicle.id } })
const LIST = { page: 1, limit: 100, skip: 0 }
const customer = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Pelanggan', role: 'pilgrim', isActive: true } })
const makeBooking = (code: string) => prisma.booking.create({ data: { bookingCode: code, userId: customer.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), status: 'active', totalAmount: 1, season: 'regular' } })

await t('BUKA: rentang jadi satu baris per tanggal, tampil di katalog booking; tanggal yang sudah ada tidak ditimpa', async () => {
  assert.deepEqual(await openQuotas({ pricingId: pricing.id, from: day(10), to: day(12), totalSeats: 45 }), { created: 3, skipped: 0 })
  const { items } = await listQuotas(trip.id, undefined, LIST)
  assert.deepEqual(items.map(q => q.travelDate), [day(10), day(11), day(12)])
  await updateQuotaSeats(items[0]!.id, 90)
  assert.deepEqual(await openQuotas({ pricingId: pricing.id, from: day(10), to: day(13), totalSeats: 10 }), { created: 1, skipped: 3 })
  const after = await listQuotas(trip.id, pricing.id, LIST)
  assert.equal(after.items[0]!.totalSeats, 90, 'tanggal lama tidak tertimpa')
  const cat = await bookingCatalog('transport') as { id: string; date: string; seatsLeft: number }[]
  const row = cat.find(c => c.id === items[0]!.id)
  assert.ok(row, 'kuota baru menjadi pilihan booking')
  assert.deepEqual([row.date, row.seatsLeft], [day(10), 90])
})

await t('BUKA DITOLAK: tanggal lampau, akhir sebelum mulai, rentang > 366 hari, kendaraan tak ada; hari ini boleh', async () => {
  await rejects(openQuotas({ pricingId: pricing.id, from: day(-1), to: day(1), totalSeats: 5 }), 422, /sudah lewat/)
  await rejects(openQuotas({ pricingId: pricing.id, from: day(5), to: day(4), totalSeats: 5 }), 422, /sebelum/)
  await rejects(openQuotas({ pricingId: pricing.id, from: day(20), to: day(20 + 366), totalSeats: 5 }), 422, /maksimal/)
  await rejects(openQuotas({ pricingId: '00000000-0000-4000-8000-000000000000', from: day(1), to: day(1), totalSeats: 5 }), 404)
  assert.equal((await openQuotas({ pricingId: pricing.id, from: today, to: today, totalSeats: 5 })).created, 1)
})

await t('VALIDATOR: kolom asing ditolak (mass assignment), kursi < 1 dan tanggal rusak ditolak', () => {
  const ok = { pricingId: pricing.id, from: day(1), to: day(2), totalSeats: 5 }
  assert.equal(openQuotasSchema.safeParse(ok).success, true)
  assert.equal(openQuotasSchema.safeParse({ ...ok, pendingSeats: 3 }).success, false)
  assert.equal(openQuotasSchema.safeParse({ ...ok, totalSeats: 0 }).success, false)
  assert.equal(openQuotasSchema.safeParse({ ...ok, from: '2026-13-40' }).success, false)
  assert.equal(updateQuotaSchema.safeParse({ totalSeats: 5, bookedSeats: 0 }).success, false)
})

await t('DAFTAR: tanggal lampau tidak tampil', async () => {
  const past = await prisma.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date(`${day(-3)}T00:00:00Z`), totalSeats: 5 } })
  const { items } = await listQuotas(trip.id, undefined, LIST)
  assert.ok(!items.some(q => q.id === past.id))
  assert.ok(items.every(q => q.travelDate >= today))
  await prisma.transportQuota.delete({ where: { id: past.id } })
})

await t('UBAH KURSI: tidak boleh di bawah kursi terpakai; tepat sama dengan terpakai boleh; tak ada → 404', async () => {
  const [q] = (await listQuotas(trip.id, undefined, LIST)).items
  await prisma.transportQuota.update({ where: { id: q!.id }, data: { pendingSeats: 3, bookedSeats: 2 } })
  await rejects(updateQuotaSeats(q!.id, 4), 409, /di bawah 5/)
  await updateQuotaSeats(q!.id, 5)
  assert.equal((await prisma.transportQuota.findUniqueOrThrow({ where: { id: q!.id } })).totalSeats, 5)
  await prisma.transportQuota.update({ where: { id: q!.id }, data: { pendingSeats: 0, bookedSeats: 0 } })
  await rejects(updateQuotaSeats('00000000-0000-4000-8000-000000000000', 4), 404)
})

await t('HAPUS KUOTA: bebas bila tak dirujuk; dirujuk booking transport atau paket ziarah (FK SET NULL) → 409 dan riwayat utuh', async () => {
  const { items } = await listQuotas(trip.id, undefined, LIST)
  const [free, a, b] = items
  await deleteQuota(free!.id)
  assert.equal(await prisma.transportQuota.count({ where: { id: free!.id } }), 0)
  const bk = await makeBooking(`${tag}-A`)
  await prisma.bookingTransport.create({ data: { bookingId: bk.id, transportQuotaId: a!.id, travelDate: new Date(`${a!.travelDate}T00:00:00Z`), numPassengers: 1, unitPrice: 1, totalPrice: 1 } })
  await rejects(deleteQuota(a!.id), 409, /pernah dipesan/)
  const tour = await prisma.tourPackage.create({ data: { name: `${tag} ziarah` } })
  const row = await prisma.bookingTourPackage.create({ data: { bookingId: bk.id, tourPackageId: tour.id, transportQuotaId: b!.id, tourDate: new Date(`${b!.travelDate}T00:00:00Z`), numPeople: 1, totalPrice: 1 } })
  await rejects(deleteQuota(b!.id), 409)
  assert.equal((await prisma.bookingTourPackage.findUniqueOrThrow({ where: { id: row.id } })).transportQuotaId, b!.id)
  await rejects(deleteQuota('00000000-0000-4000-8000-000000000000'), 404)
})

await t('HAPUS HARGA KENDARAAN: kuota tak terpakai + titik harga + biaya ikut hilang; dirujuk booking atau paket → nonaktif, data utuh', async () => {
  const other = await prisma.transportPricing.create({ data: { tripId: (await makeTrip('hapus')).id, vehicleId: vehicle.id } })
  await openQuotas({ pricingId: other.id, from: day(1), to: day(3), totalSeats: 5 })
  await prisma.pricePoint.create({ data: { ownerType: 'transport', ownerId: other.id, unit: 'vehicle', autoSellIdr: 100, sellIdr: 100 } })
  assert.deepEqual(await deleteTransportPricing(other.id), { deleted: true })
  assert.equal(await prisma.transportQuota.count({ where: { pricingId: other.id } }), 0)
  assert.equal(await prisma.pricePoint.count({ where: { ownerType: 'transport', ownerId: other.id } }), 0)

  const out = await deleteTransportPricing(pricing.id)
  assert.equal(out.deleted, false)
  assert.equal((await prisma.transportPricing.findUniqueOrThrow({ where: { id: pricing.id } })).isActive, false)
  assert.ok((await prisma.transportQuota.count({ where: { pricingId: pricing.id } })) > 0)
  await prisma.transportPricing.update({ where: { id: pricing.id }, data: { isActive: true } })

  const locked = await prisma.transportPricing.create({ data: { tripId: (await makeTrip('paket')).id, vehicleId: vehicle.id } })
  const pkg = await prisma.package.create({ data: { name: `${tag} paket`, includedTransportPricingId: locked.id } })
  assert.equal((await deleteTransportPricing(locked.id)).deleted, false, 'paket yang mengunci kendaraan tidak boleh kehilangan rujukan diam-diam')
  assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } })).includedTransportPricingId, locked.id)
  await assert.rejects(deleteTransportPricing('00000000-0000-4000-8000-000000000000'), (e: { code?: string }) => e.code === 'P2025')
})

await t('HAPUS TRIP: tanpa rujukan semuanya hilang; ada booking atau paket → nonaktif', async () => {
  const fresh = await makeTrip('bersih')
  const p = await prisma.transportPricing.create({ data: { tripId: fresh.id, vehicleId: vehicle.id } })
  await openQuotas({ pricingId: p.id, from: day(1), to: day(2), totalSeats: 5 })
  assert.deepEqual(await deleteTransportTrip(fresh.id), { deleted: true })
  assert.equal(await prisma.transportTrip.count({ where: { id: fresh.id } }), 0)
  assert.equal(await prisma.transportPricing.count({ where: { id: p.id } }), 0)

  assert.equal((await deleteTransportTrip(trip.id)).deleted, false)
  assert.equal((await prisma.transportTrip.findUniqueOrThrow({ where: { id: trip.id } })).isActive, false)

  const linked = await makeTrip('tertaut')
  const tour = await prisma.tourPackage.create({ data: { name: `${tag} ziarah2`, transportTripId: linked.id } })
  assert.equal((await deleteTransportTrip(linked.id)).deleted, false)
  assert.equal((await prisma.tourPackage.findUniqueOrThrow({ where: { id: tour.id } })).transportTripId, linked.id)
})

await t('ROUTE: semua metode memeriksa peran manager; penulis kuota hanya lib/transport/quotas.ts', () => {
  const root = new URL('..', import.meta.url).pathname
  const read = (f: string) => readFileSync(root + f, 'utf8')
  const list = read('app/api/v1/admin/products/transport/quotas/route.ts')
  const one = read('app/api/v1/admin/products/transport/quotas/[id]/route.ts')
  assert.equal(list.match(/await requireManager\(\)/g)?.length, 2)
  assert.equal(one.match(/await requireManager\(\)/g)?.length, 2)
  const panel = read('app/[locale]/admin/(protected)/products/transport/trips/[id]/TransportQuotaPanel.tsx')
  assert.ok(!/window\.(confirm|alert)/.test(panel))
  const writers = execSync(String.raw`grep -rlE "transportQuota\.(create|createMany|upsert|delete|deleteMany)\(" app lib`, { cwd: root, encoding: 'utf8' }).trim().split('\n').sort()
  assert.deepEqual(writers, ['lib/admin/productDelete.ts', 'lib/transport/quotas.ts'])
})

await prisma.$disconnect()
if (failed) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
