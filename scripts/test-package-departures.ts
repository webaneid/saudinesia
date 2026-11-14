// Keberangkatan Paket Umroh (K1 F1, docs/arsitektur-paket-umroh.md §8): validator, rumus tanggal pulang, penulis tunggal
// lib/packages/departures.ts (buat/ubah/hapus-aman), CHECK database, dan penjaga sumber "tak ada penulis lain".
// MENULIS ke database — hanya di database sekali pakai (assertThrowawayDb).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { retrySerializable } from '@/lib/booking/serializable'
import { addDays, dbDateOf, todayInApp } from '@/lib/time'
import { packageReturnDate, seatsLeft } from '@/lib/packages/dates'
import { departureWarnings } from '@/lib/packages/warnings'
import { confirmPackageDepartureQuota, releasePackageDepartureQuota, reservePackageDepartureQuota } from '@/lib/quota'
import { ItemNotBookableError, QuotaExhaustedError } from '@/lib/booking/errors'
import { bookableDepartures, createDeparture, deleteOrDeactivateDeparture, DepartureError, listDepartures, updateDeparture } from '@/lib/packages/departures'
import { departureCreateSchema, departureUpdateSchema, packageDetailSchema, readExclusions, readItinerary } from '@/lib/validators/package'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const code = async (p: Promise<unknown>) => { try { await p } catch (e) { if (e instanceof DepartureError) return e.code; throw e } assert.fail('seharusnya ditolak') }
const tag = `dep${Date.now()}`
const today = todayInApp()

// ── murni ────────────────────────────────────────────────────────────────────────────────────────────────────────────
await t('tanggal pulang = berangkat + durasi − 1 (9 hari → +8; 1 hari → hari yang sama; lintas bulan/tahun)', () => {
  assert.equal(packageReturnDate('2026-12-15', 9), '2026-12-23')
  assert.equal(packageReturnDate('2026-12-15', 1), '2026-12-15')
  assert.equal(packageReturnDate('2026-12-28', 9), '2027-01-05')
  assert.equal(packageReturnDate('2028-02-25', 6), '2028-03-01') // kabisat
  assert.equal(seatsLeft({ totalSeats: 10, pendingSeats: 3, bookedSeats: 4 }), 3)
  assert.equal(seatsLeft({ totalSeats: 5, pendingSeats: 3, bookedSeats: 4 }), 0)
})

await t('validator: ketat (kursi ditahan/terjual/harga dari klien ditolak), tanggal kalender, batas kursi', () => {
  assert.ok(departureCreateSchema.safeParse({ departureDate: '2026-12-15', totalSeats: 45 }).success)
  for (const bad of [
    { departureDate: '2026-12-15', totalSeats: 45, pendingSeats: 0 },
    { departureDate: '2026-12-15', totalSeats: 45, bookedSeats: 0 },
    { departureDate: '2026-12-15', totalSeats: 45, price: 1 },
    { departureDate: '2026-12-15', totalSeats: 0 },
    { departureDate: '2026-12-15', totalSeats: 1001 },
    { departureDate: '2026-12-15', totalSeats: 1.5 },
    { departureDate: '2026-13-01', totalSeats: 5 },
    { departureDate: '15-12-2026', totalSeats: 5 },
  ]) assert.equal(departureCreateSchema.safeParse(bad).success, false, JSON.stringify(bad))
  assert.equal(departureUpdateSchema.safeParse({}).success, false, 'ubah tanpa isi ditolak')
  assert.ok(departureUpdateSchema.safeParse({ totalSeats: 50 }).success)
})

await t('validator detail: hari unik berurutan, tak melewati durasi, tidak termasuk berbatas; JSON rusak dibaca kosong', () => {
  const day = (d: number) => ({ day: d, title: `Hari ${d}`, body: '' })
  assert.ok(packageDetailSchema.safeParse({ durationDays: 9, itinerary: [day(1), day(2), day(9)], exclusions: ['Paspor'] }).success)
  assert.equal(packageDetailSchema.safeParse({ itinerary: [day(2), day(1)] }).success, false, 'tak berurutan')
  assert.equal(packageDetailSchema.safeParse({ itinerary: [day(1), day(1)] }).success, false, 'ganda')
  assert.equal(packageDetailSchema.safeParse({ durationDays: 3, itinerary: [day(4)] }).success, false, 'melewati durasi')
  assert.equal(packageDetailSchema.safeParse({ durationDays: 0 }).success, false)
  assert.equal(packageDetailSchema.safeParse({ durationDays: 61 }).success, false)
  assert.equal(packageDetailSchema.safeParse({ exclusions: Array.from({ length: 31 }, () => 'x') }).success, false)
  assert.equal(packageDetailSchema.safeParse({ itinerary: [{ ...day(1), html: '<b>' }] }).success, false, 'kunci liar')
  assert.deepEqual(readItinerary({ not: 'array' }), [])
  assert.deepEqual(readItinerary([{ day: 1 }]), [])
  assert.deepEqual(readExclusions(['a', 'b']), ['a', 'b'])
  assert.deepEqual(readExclusions('x'), [])
})

await t('peringatan: hanya mengingatkan — durasi kosong, malam hotel > durasi − 1, tak ada yang aktif, di luar periode tiket/hotel', () => {
  const dep = (id: string, departureDate: string, isActive = true) => ({ id, departureDate, isActive })
  assert.deepEqual(departureWarnings({ durationDays: 9, includedNights: 8, periods: [], departures: [dep('a', '2026-12-15')] }), { package: [], byDeparture: {} })
  assert.match(departureWarnings({ durationDays: null, includedNights: 0, periods: [], departures: [] }).package.join(), /Durasi paket belum diisi/)
  assert.match(departureWarnings({ durationDays: 9, includedNights: 9, periods: [], departures: [] }).package.join(), /melebihi durasi paket − 1 \(8 malam\)/)
  assert.match(departureWarnings({ durationDays: 9, includedNights: 0, periods: [], departures: [dep('a', '2026-12-15', false)] }).package.join(), /Tidak ada keberangkatan aktif/)
  // tiket: hanya tanggal berangkat; hotel: seluruh berangkat–pulang (15–23 Des)
  const periods = [
    { label: 'Tiket X', from: '2026-12-01', to: '2026-12-15', covers: 'departure' as const },
    { label: 'Hotel Y', from: '2026-12-01', to: '2026-12-22', covers: 'stay' as const },
  ]
  const w = departureWarnings({ durationDays: 9, includedNights: 0, periods, departures: [dep('a', '2026-12-15'), dep('b', '2026-12-10'), dep('c', '2026-11-30')] })
  assert.deepEqual(w.byDeparture.a, ['Di luar periode Hotel Y (2026-12-01 s.d. 2026-12-22).'])
  assert.equal(w.byDeparture.b, undefined)
  assert.equal(w.byDeparture.c?.length, 2)
})

// ── penulis ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const pkg = await prisma.package.create({ data: { name: `${tag} Paket`, durationDays: 9 } })
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, fullName: tag, passwordHash: 'x', role: 'pilgrim' } })
const d1 = addDays(today, 40)

await t('buat: tanggal pulang turunan durasi, sisa kursi; masa lalu/duplikat/paket tak ada ditolak berkode', async () => {
  const v = await createDeparture(pkg.id, { departureDate: d1, totalSeats: 45, note: 'kursi dari blok GA' })
  assert.equal(v.returnDate, addDays(d1, 8))
  assert.equal(v.seatsLeft, 45)
  assert.equal(v.isActive, true)
  assert.equal(await code(createDeparture(pkg.id, { departureDate: addDays(today, -1), totalSeats: 5 })), 'departurePast')
  assert.equal(await code(createDeparture(pkg.id, { departureDate: d1, totalSeats: 5 })), 'departureDuplicate')
  assert.equal(await code(createDeparture('00000000-0000-4000-8000-000000000000', { departureDate: d1, totalSeats: 5 })), 'packageNotFound')
  assert.ok((await createDeparture(pkg.id, { departureDate: today, totalSeats: 5 })).id, 'hari ini masih boleh')
})

await t('daftar: urut tanggal; paket tanpa durasi → tanggal pulang null', async () => {
  const list = await listDepartures(pkg.id)
  assert.deepEqual(list.map(d => d.departureDate), [today, d1])
  const noDur = await prisma.package.create({ data: { name: `${tag} Tanpa Durasi` } })
  await createDeparture(noDur.id, { departureDate: d1, totalSeats: 5 })
  assert.equal((await listDepartures(noDur.id))[0]!.returnDate, null)
  assert.equal(await code(listDepartures('00000000-0000-4000-8000-000000000000')), 'packageNotFound')
})

await t('ubah: kursi tak boleh di bawah ditahan + terjual; tanggal terkunci setelah dipesan; ke masa lalu ditolak', async () => {
  const dep = (await listDepartures(pkg.id)).find(d => d.departureDate === d1)!
  await prisma.$executeRaw`UPDATE "package_departures" SET "pendingSeats" = 3, "bookedSeats" = 4 WHERE "id" = ${dep.id}` // simulasi kursi (F3: lib/quota)
  assert.equal(await code(updateDeparture(pkg.id, dep.id, { totalSeats: 6 })), 'departureSeatsBelowSold')
  assert.equal((await updateDeparture(pkg.id, dep.id, { totalSeats: 7 })).seatsLeft, 0)
  assert.equal(await code(updateDeparture(pkg.id, dep.id, { departureDate: addDays(today, -3) })), 'departurePast')
  const moved = await updateDeparture(pkg.id, dep.id, { departureDate: addDays(d1, 1), totalSeats: 50, note: null })
  assert.equal(moved.departureDate, addDays(d1, 1)); assert.equal(moved.note, null)
  assert.equal(await code(updateDeparture(pkg.id, dep.id, { departureDate: today })), 'departureDuplicate')
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-1`, userId: user.id, season: 'regular', totalAmount: 1 } })
  await prisma.bookingPackage.create({ data: { bookingId: b.id, packageId: pkg.id, departureId: dep.id, departureDate: dbDateOf(addDays(d1, 1)), returnDate: dbDateOf(addDays(d1, 9)), numPeople: 2, totalPrice: 1 } })
  assert.equal(await code(updateDeparture(pkg.id, dep.id, { departureDate: addDays(d1, 5) })), 'departureDateLocked')
  assert.equal((await updateDeparture(pkg.id, dep.id, { departureDate: addDays(d1, 1), isActive: false })).isActive, false, 'tanggal sama tak dianggap perubahan')
  assert.equal(await code(updateDeparture(pkg.id, '00000000-0000-4000-8000-000000000000', { totalSeats: 5 })), 'departureNotFound')
  const other = await prisma.package.create({ data: { name: `${tag} Paket Lain` } })
  assert.equal(await code(updateDeparture(other.id, dep.id, { totalSeats: 99 })), 'departureNotFound', 'id keberangkatan paket lain ditolak')
  assert.equal(await code(deleteOrDeactivateDeparture(other.id, dep.id)), 'departureNotFound')
})

await t('hapus aman: belum dipesan → dihapus; sudah dipesan → dinonaktifkan dan tetap ada', async () => {
  const list = await listDepartures(pkg.id)
  const free = list.find(d => d.bookingCount === 0)!
  const used = list.find(d => d.bookingCount > 0)!
  assert.deepEqual(await deleteOrDeactivateDeparture(pkg.id, free.id), { deleted: true })
  assert.equal(await prisma.packageDeparture.count({ where: { id: free.id } }), 0)
  await updateDeparture(pkg.id, used.id, { isActive: true })
  assert.deepEqual(await deleteOrDeactivateDeparture(pkg.id, used.id), { deleted: false, bookingCount: 1 })
  assert.equal((await prisma.packageDeparture.findUniqueOrThrow({ where: { id: used.id } })).isActive, false)
  assert.equal(await code(deleteOrDeactivateDeparture(pkg.id, free.id)), 'departureNotFound')
})

await t('kursi (F3, lib/quota): tahan dikunci — habis 409 berkode, nonaktif/lewat 422; konfirmasi/lepas memindahkan pending/booked; daftar yang bisa dipilih', async () => {
  const dep = await createDeparture(pkg.id, { departureDate: addDays(today, 60), totalSeats: 3 })
  const seats = () => prisma.packageDeparture.findUniqueOrThrow({ where: { id: dep.id }, select: { pendingSeats: true, bookedSeats: true } })
  // tanggal yang dibaca saat resolve berbeda di dalam kunci (SEC-232) → ditolak tanpa menahan
  await assert.rejects(prisma.$transaction(tx => reservePackageDepartureQuota(tx, dep.id, 1, addDays(dep.departureDate, 1))), (e: unknown) => e instanceof ItemNotBookableError && e.code === 'itemPackageDepartureUnavailable')
  await prisma.$transaction(tx => reservePackageDepartureQuota(tx, dep.id, 2, dep.departureDate))
  await assert.rejects(prisma.$transaction(tx => reservePackageDepartureQuota(tx, dep.id, 2)), (e: unknown) => e instanceof QuotaExhaustedError && e.code === 'quotaPackageDeparture' && e.params?.have === 1)
  assert.deepEqual(await seats(), { pendingSeats: 2, bookedSeats: 0 }, 'penolakan tak menahan apa pun')
  await prisma.$transaction(tx => confirmPackageDepartureQuota(tx, dep.id, 2))
  assert.deepEqual(await seats(), { pendingSeats: 0, bookedSeats: 2 })
  await prisma.$transaction(tx => releasePackageDepartureQuota(tx, dep.id, 2, true))
  assert.deepEqual(await seats(), { pendingSeats: 0, bookedSeats: 0 })
  await updateDeparture(pkg.id, dep.id, { isActive: false })
  await assert.rejects(prisma.$transaction(tx => reservePackageDepartureQuota(tx, dep.id, 1)), (e: unknown) => e instanceof ItemNotBookableError && e.code === 'itemPackageDepartureUnavailable')
  const past = await prisma.packageDeparture.create({ data: { packageId: pkg.id, departureDate: dbDateOf(addDays(today, -2)), totalSeats: 5 } })
  await assert.rejects(prisma.$transaction(tx => reservePackageDepartureQuota(tx, past.id, 1)), (e: unknown) => e instanceof ItemNotBookableError && e.code === 'itemPackageDeparturePast')
  // dapat dipilih: aktif + belum lewat + paket berdurasi; yang penuh tetap tampil (sisa 0); tanpa catatan internal
  const bookable = (await bookableDepartures([pkg.id])).get(pkg.id) ?? []
  assert.ok(!bookable.some(d => d.id === dep.id || d.id === past.id), 'nonaktif/lewat tidak ditawarkan')
  assert.ok(bookable.every(d => d.departureDate >= today && d.returnDate === addDays(d.departureDate, 8) && !('note' in d)))
  const noDur = await prisma.package.findFirstOrThrow({ where: { name: `${tag} Tanpa Durasi` } })
  assert.equal((await bookableDepartures([noDur.id])).get(noDur.id), undefined, 'paket tanpa durasi tak punya keberangkatan yang bisa dipilih')
})

await t('deadlock (SEC-233): transaksi booking yang kena 40P01 diulang, bukan 500', async () => {
  const deadlock = () => new Prisma.PrismaClientKnownRequestError('deadlock detected', { code: 'P2010', clientVersion: Prisma.prismaVersion.client, meta: { code: '40P01' } })
  let runs = 0
  assert.equal(await retrySerializable(async () => { if (++runs === 1) throw deadlock(); return 'ok' }), 'ok')
  assert.equal(runs, 2)
  let other = 0
  await assert.rejects(retrySerializable(async () => { other++; throw new Error('lain') }), /lain/)
  assert.equal(other, 1, 'galat lain tidak diulang')
})

await t('CHECK database: kursi negatif / ditahan + terjual > total / durasi di luar 1..60 / JSON bukan array ditolak', async () => {
  const dep = (await listDepartures(pkg.id))[0]!
  for (const sql of [
    prisma.$executeRaw`UPDATE "package_departures" SET "pendingSeats" = -1 WHERE "id" = ${dep.id}`,
    prisma.$executeRaw`UPDATE "package_departures" SET "pendingSeats" = "totalSeats" + 1 WHERE "id" = ${dep.id}`,
    prisma.$executeRaw`UPDATE "packages" SET "durationDays" = 0 WHERE "id" = ${pkg.id}`,
    prisma.$executeRaw`UPDATE "packages" SET "durationDays" = 61 WHERE "id" = ${pkg.id}`,
    prisma.$executeRaw`UPDATE "packages" SET "itinerary" = '{}'::jsonb WHERE "id" = ${pkg.id}`,
    prisma.$executeRaw`UPDATE "packages" SET "exclusions" = '"x"'::jsonb WHERE "id" = ${pkg.id}`,
  ]) await assert.rejects(sql)
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
await t('penjaga: tabel package_departures hanya ditulis lib/packages/departures.ts (dan lib/quota untuk kursi)', () => {
  const root = new URL('..', import.meta.url).pathname
  const files: string[] = []
  const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p) } }
  for (const d of ['app', 'lib', 'components']) walk(join(root, d))
  const write = /packageDeparture\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?package_departures/i
  const offenders = files.filter(f => write.test(readFileSync(f, 'utf8')))
    .map(f => f.slice(root.length)).filter(f => f !== 'lib/packages/departures.ts' && !f.startsWith('lib/quota/'))
  assert.deepEqual(offenders, [])
  assert.match(readFileSync(join(root, 'lib/admin/productDelete.ts'), 'utf8'), /dropDeparturesOf\(tx, id\)/, 'penghapus paket membersihkan keberangkatan')
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.deleteMany({ where: { userId: user.id } })
await prisma.packageDeparture.deleteMany({ where: { package: { name: { startsWith: tag } } } })
await prisma.package.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.user.delete({ where: { id: user.id } })

if (failed) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
