// Uji migrasi backfill titik harga (prisma/migrations/20261028140000_price_points_backfill; docs/arsitektur-harga-terpadu.md §15, Fase 2).
// Membangun database "pra-migrasi", mengisi data lama lewat ORM (kolom cache lama), lalu menjalankan migrasi lewat `prisma migrate deploy` sungguhan.
// Dibuktikan: baris berharga → titik harga (modal NULL, jual = harga lama) dengan aturan yang SAMA dengan mesin (dasar hanya > 0, komposit selalu, Visa dari
// rentang tier), titik yang sudah ada TIDAK ditimpa, idempoten (jalan kedua tanpa efek), dan tabel kosong aman.
//
// PENGAMAN: membuat/menghapus database sementara `<db>_tmp_*` di server yang sama — menolak jalan kecuali DATABASE_URL adalah DB uji.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

const MIGRATION = '20261028140000_price_points_backfill'
const root = new URL('..', import.meta.url).pathname
const base = new URL(process.env.DATABASE_URL!)
const suffix = `_tmp_mig${Date.now().toString(36)}`
const dbUrl = (name: string) => { const u = new URL(base); u.pathname = `/${name}`; return u.toString() }
const mainName = base.pathname.slice(1)
const baseName = `${mainName}${suffix}_base`
const created: string[] = []

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}

// Biner Prisma PROYEK (bukan `bunx prisma` dari direktori sementara — itu mengunduh versi lain dari npm).
const PRISMA = join(root, 'node_modules/.bin/prisma')
const admin = new PrismaClient({ datasourceUrl: base.toString() })
const run = (url: string, args: string[], stdin?: string) => {
  const r = spawnSync(PRISMA, args, { cwd: tmp, env: { ...process.env, DATABASE_URL: url }, input: stdin, encoding: 'utf8' })
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` }
}
const query = async (name: string, sql: string) => {
  const c = new PrismaClient({ datasourceUrl: dbUrl(name) })
  try { return (await c.$queryRawUnsafe(sql)) as Array<Record<string, unknown>> } finally { await c.$disconnect() }
}
// SQL lewat BERKAS (`--file`), bukan `--stdin`: di CI stdin tidak sampai ke prisma dan setup diam-diam kosong (jalur "harus gagal" malah sukses).
let sqlFileN = 0
const exec = (name: string, sql: string) => {
  const file = join(tmp, `setup-${++sqlFileN}.sql`)
  writeFileSync(file, sql)
  return run(dbUrl(name), ['db', 'execute', '--file', file, '--schema', 'schema.prisma'])
}

// Schema + migrasi sementara TANPA migrasi yang diuji.
const tmp = mkdtempSync(join(tmpdir(), 'vendor-mig-'))
mkdirSync(join(tmp, 'migrations'))
cpSync(join(root, 'prisma/schema.prisma'), join(tmp, 'schema.prisma'))
cpSync(join(root, 'prisma/migrations/migration_lock.toml'), join(tmp, 'migrations/migration_lock.toml'))
for (const d of readdirSync(join(root, 'prisma/migrations'))) {
  if (d >= MIGRATION || d.endsWith('.toml')) continue
  cpSync(join(root, 'prisma/migrations', d), join(tmp, 'migrations', d), { recursive: true })
}

async function newDb(name: string, template?: string) {
  assert.ok(name.includes('_tmp_') && name !== mainName, `nama DB sementara tidak aman: ${name}`)
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ''}`)
  created.push(name)
}

console.log('== membangun DB pra-migrasi ==')
await newDb(baseName)
const pre = run(dbUrl(baseName), ['migrate', 'deploy', '--schema', 'schema.prisma'])
assert.equal(pre.code, 0, `migrate deploy (pra) gagal:\n${pre.out.slice(-600)}`)
// Sekarang tambahkan migrasi yang diuji — hanya akan diterapkan di salinan skenario.
cpSync(join(root, 'prisma/migrations', MIGRATION), join(tmp, 'migrations', MIGRATION), { recursive: true })

let n = 0
async function scenario(setup: string) {
  const name = `${mainName}${suffix}_s${++n}`
  await newDb(name, baseName)
  if (setup) {
    const r = exec(name, setup)
    assert.equal(r.code, 0, `setup skenario gagal:\n${r.out.slice(-500)}`)
  }
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ...res }
}
const points = (name: string) => query(name, `select "ownerType" as t, "variantKey" as v, unit, "costIdr"::float as cost, "autoSellIdr"::float as auto, "manualSellIdr"::float as manual, "sellIdr"::float as sell from price_points order by "ownerType", "ownerId", "variantKey"`)

// Skenario: DB dari templat + data lama lewat ORM, lalu migrasi.
async function scenarioWith(fixtures: (db: PrismaClient) => Promise<Record<string, string>>) {
  const name = `${mainName}${suffix}_s${++n}`
  await newDb(name, baseName)
  const db = new PrismaClient({ datasourceUrl: dbUrl(name) })
  let ids: Record<string, string>
  try { ids = await fixtures(db) } finally { await db.$disconnect() }
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ids, ...res }
}

async function legacyWorld(db: PrismaClient): Promise<Record<string, string>> {
  const route = await db.flightRoute.create({ data: { origin: 'CGK', destination: 'JED' } })
  const flight = await db.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-01-01'), departureTo: new Date('2090-01-31'), price: 23_000_000 } })
  const flight0 = await db.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-02-01'), departureTo: new Date('2090-02-28'), price: 0 } })
  const roomType = await db.roomType.create({ data: { name: 'Quad', defaultCapacity: 4 } })
  const hotel = await db.hotel.create({ data: { name: 'H', city: 'makkah' } })
  const period = await db.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
  const room = await db.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, price: 1_200_000, totalQuota: 5 } })
  const room0 = await db.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: (await db.roomType.create({ data: { name: 'Double', defaultCapacity: 2 } })).id, price: 0, totalQuota: 5 } })
  const trip = await db.transportTrip.create({ data: { name: 'T', origin: 'A', destination: 'B' } })
  const vehicle = await db.transportVehicle.create({ data: { name: 'Bus', vehicleType: 'bus', capacity: 40 } })
  const transport = await db.transportPricing.create({ data: { tripId: trip.id, vehicleId: vehicle.id, price: 6_000_000 } })
  // Tabel yang berubah di migrasi LEBIH BARU (muthowif_service_price.singleton, price_points.manual*) diisi lewat SQL: client Prisma terbaru mengenal kolom yang DB pra-migrasi belum punya.
  const muthowif = { id: '00000000-0000-4000-8000-0000000000cc' }
  await db.$executeRawUnsafe(`insert into muthowif_service_price (id, price, "updatedAt") values ('${muthowif.id}', 450000, now())`)
  const haji = await db.hajiProduct.create({ data: { name: 'HJ', hajiType: 'reguler', year: 2090, price: 4_200_000 } })
  const haji0 = await db.hajiProduct.create({ data: { name: 'HJ0', hajiType: 'reguler', year: 2091, price: 0 } })
  const pkg = await db.package.create({ data: { name: 'P', price: 6_600_000 } })
  const tour = await db.tourPackage.create({ data: { name: 'Z', price: 350_000 } })
  const visa = await db.visaProduct.create({ data: { name: 'V', visaType: 'Umroh', price: 2_500_000, durationFeeRules: [{ minDays: 1, maxDays: 14, fee: 2_500_000 }, { minDays: 15, maxDays: 30, fee: 2_900_000 }, { minDays: 31, maxDays: 40, fee: 0 }] } })
  const visaNoRules = await db.visaProduct.create({ data: { name: 'V0', visaType: 'Umroh', price: 1_000_000, durationFeeRules: [] } })
  return { flight: flight.id, flight0: flight0.id, room: room.id, room0: room0.id, transport: transport.id, muthowif: muthowif.id, haji: haji.id, haji0: haji0.id, pkg: pkg.id, tour: tour.id, visa: visa.id, visaNoRules: visaNoRules.id }
}

console.log('== skenario ==')

await t('semua pemilik berharga → titik harga (modal NULL, jual = harga lama); harga 0 dilewati untuk modul dasar tetapi komposit SELALU; Visa dari rentang tier > 0', async () => {
  const r = await scenarioWith(legacyWorld)
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const rows = await points(r.name)
  const by = (t: string) => rows.filter(x => x.t === t)
  assert.deepEqual(by('flight').map(x => [x.v, x.unit, x.cost, x.auto, x.manual, x.sell]), [['', 'person', null, 23_000_000, null, 23_000_000]], 'jadwal berharga 0 tidak dapat titik')
  assert.deepEqual(by('hotel').map(x => [x.unit, x.sell]), [['room_night', 1_200_000]])
  assert.deepEqual(by('transport').map(x => [x.unit, x.sell]), [['vehicle', 6_000_000]])
  // Migrasi lama sudah menanam satu baris tarif muthowif (seed 300.000) — ikut terbawa, di samping baris uji.
  assert.deepEqual(by('muthowif').map(x => [x.unit, x.sell]).sort((a, b) => Number(a[1]) - Number(b[1])), [['person_day', 300_000], ['person_day', 450_000]])
  assert.deepEqual(by('haji').map(x => x.sell).sort((a, b) => Number(a) - Number(b)), [0, 4_200_000], 'komposit selalu dapat titik, juga yang bernilai 0')
  assert.deepEqual(by('package').map(x => x.sell), [6_600_000]); assert.deepEqual(by('tour_package').map(x => x.sell), [350_000])
  assert.deepEqual(by('visa').map(x => [x.v, x.sell]), [['days:1-14', 2_500_000], ['days:15-30', 2_900_000]], 'tier fee 0 dan produk tanpa rentang tidak dapat titik')
  assert.ok(rows.every(x => x.cost === null), 'modal belum diketahui → NULL (diisi repriceAll saat boot)')
})

await t('titik yang SUDAH ada (ditulis mesin) tidak ditimpa; harga baru dari kolom lama tak masuk bila titiknya ada', async () => {
  const r = await scenarioWith(async db => {
    const ids = await legacyWorld(db)
    await db.$executeRawUnsafe(`insert into price_points (id, "ownerType", "ownerId", "variantKey", unit, "costIdr", "autoSellIdr", "sellIdr", "updatedAt") values (gen_random_uuid()::text, 'flight', '${ids.flight}', '', 'person', 19150000, 24000000, 24000000, now())`)
    return ids
  })
  assert.equal(r.code, 0, r.out.slice(-400))
  const f = (await points(r.name)).filter(x => x.t === 'flight')
  assert.deepEqual(f.map(x => [x.cost, x.sell]), [[19_150_000, 24_000_000]])
})

await t('IDEMPOTEN: menjalankan SQL migrasi sekali lagi tidak mengubah apa pun', async () => {
  const r = await scenarioWith(legacyWorld)
  assert.equal(r.code, 0, r.out.slice(-400))
  const before = await points(r.name)
  const sql = readFileSync(join(root, 'prisma/migrations', MIGRATION, 'migration.sql'), 'utf8')
  const again = exec(r.name, sql)
  assert.equal(again.code, 0, `jalan kedua harus sukses:\n${again.out.slice(-300)}`)
  assert.deepEqual(await points(r.name), before)
})

await t('tabel sumber kosong: berhasil dan tak ada titik harga baru; durationFeeRules bukan array tidak merusak', async () => {
  const empty = await scenarioWith(async () => ({}))
  assert.equal(empty.code, 0, empty.out.slice(-300)); assert.deepEqual((await points(empty.name)).map(x => x.t), ['muthowif'], 'hanya baris tarif muthowif bawaan migrasi lama')
  const odd = await scenarioWith(async db => ({ v: (await db.visaProduct.create({ data: { name: 'V', visaType: 'Umroh', price: 1, durationFeeRules: { bukan: 'array' } } })).id }))
  assert.equal(odd.code, 0, odd.out.slice(-300)); assert.deepEqual((await points(odd.name)).map(x => x.t), ['muthowif'])
})

// Uji drift skema ada di migrasi TERBARU (scripts/test-price-manual-audit-migration.ts) — di sini skema sudah lebih maju dari migrasi yang diuji.

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await admin.$disconnect()
const cleaner = new PrismaClient({ datasourceUrl: base.toString() })
for (const name of created.reverse()) {
  assert.ok(name.includes('_tmp_') && name !== mainName)
  await cleaner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`).catch(() => {})
}
await cleaner.$disconnect()
rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
