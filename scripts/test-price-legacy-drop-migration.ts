// Uji migrasi KONTRAKSI harga (prisma/migrations/20261029090000_price_legacy_columns_drop; docs/arsitektur-harga-terpadu.md §18, Fase 5).
// Dibuktikan: kolom harga lama hilang bila setiap harga lama sudah punya titik harga; FAIL-CLOSED + ATOMIK untuk tiap tabel (satu harga lama tanpa titik → migrasi berhenti,
// SEMUA kolom tetap ada, tak ada yang berubah); riwayat kurs/vendor beku Visa dipindah ke snapshot-nya lewat trigger yang dinonaktifkan HANYA selama migrasi dan aktif lagi sesudahnya.
//
// PENGAMAN: membuat/menghapus database sementara `<db>_tmp_*` di server yang sama — menolak jalan kecuali DATABASE_URL adalah DB uji.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { LEGACY_DEFAULTS_SQL, setLegacy } from './lib/legacyPriceColumns'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

const MIGRATION = '20261029090000_price_legacy_columns_drop'
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
assert.equal(exec(baseName, LEGACY_DEFAULTS_SQL).code, 0, 'default kolom harga lama gagal dipasang')
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
const snaps = (name: string, bookingId: string) => query(name, `select "itemType" as t, "lineKey" as k, "itemLabel" as label, "itemDetail" as detail, "itemQty" as iq, "unitCostIdr"::float as cost, "totalSellIdr"::float as sell, mode from price_snapshots where "bookingId" = '${bookingId}' order by "itemType", "lineKey"`)

async function scenarioWith(fixtures: (db: PrismaClient) => Promise<Record<string, string>>) {
  const name = `${mainName}${suffix}_s${++n}`
  await newDb(name, baseName)
  const db = new PrismaClient({ datasourceUrl: dbUrl(name) })
  let ids: Record<string, string>
  try { ids = await fixtures(db) } finally { await db.$disconnect() }
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ids, ...res }
}

let seq = 0
const LEGACY_COLUMNS: Array<[string, string]> = [
  ['flight_schedules', 'price'], ['hotel_room_schedules', 'price'], ['hotel_services', 'price'], ['transport_pricing', 'price'], ['muthowif_service_price', 'price'],
  ['haji_products', 'price'], ['packages', 'price'], ['tour_packages', 'price'], ['visa_products', 'price'], ['visa_products', 'durationFeeRules'],
  ['catering_options', 'pricePerPersonRegular'], ['catering_options', 'pricePerPersonRamadan'], ['catering_options', 'pricePerPersonHajj'],
  ['visa_applications', 'hppSnapshotRupiah'], ['visa_applications', 'sellPriceSnapshot'], ['visa_applications', 'exchangeRateIdsUsed'], ['visa_applications', 'vendorIdsUsed'],
]
const columnsLeft = async (name: string) => {
  const rows = await query(name, `select table_name as t, column_name as c from information_schema.columns where (table_name, column_name) in (${LEGACY_COLUMNS.map(([t, c]) => `('${t}','${c}')`).join(',')})`)
  return rows.map(r => `${r.t}.${r.c}`).sort()
}
const point = (db: PrismaClient, ownerType: string, ownerId: string, sell: number, variantKey = '', unit = 'package') =>
  db.pricePoint.create({ data: { ownerType, ownerId, variantKey, unit, autoSellIdr: sell, sellIdr: sell } })

/** Satu pemilik per tabel, masing-masing dengan harga lama > 0. `withPoints=false` → tanpa titik harga. */
async function world(db: PrismaClient, withPoints: boolean, skip?: string) {
  const ids: Record<string, string> = {}
  const route = await db.flightRoute.create({ data: { origin: 'CGK', destination: 'JED' } })
  const flight = await db.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-01-01'), departureTo: new Date('2090-01-31') } })
  await setLegacy(db, 'flight_schedules', flight.id, { price: 23_000_000 }); ids.flight_schedules = flight.id
  const roomType = await db.roomType.create({ data: { name: 'Quad', defaultCapacity: 4 } })
  const hotel = await db.hotel.create({ data: { name: 'H', city: 'makkah' } })
  const period = await db.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
  const room = await db.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: roomType.id, totalQuota: 5 } })
  await setLegacy(db, 'hotel_room_schedules', room.id, { price: 1_200_000 }); ids.hotel_room_schedules = room.id
  const svc = await db.hotelService.create({ data: { hotelId: hotel.id, serviceName: 'Laundry' } })
  await setLegacy(db, 'hotel_services', svc.id, { price: 50_000 }); ids.hotel_services = svc.id
  const trip = await db.transportTrip.create({ data: { name: 'T', origin: 'A', destination: 'B' } })
  const vehicle = await db.transportVehicle.create({ data: { name: 'Bus', vehicleType: 'bus', capacity: 40 } })
  const tp = await db.transportPricing.create({ data: { tripId: trip.id, vehicleId: vehicle.id } })
  await setLegacy(db, 'transport_pricing', tp.id, { price: 6_000_000 }); ids.transport_pricing = tp.id
  const muth = await db.muthowifServicePrice.findFirst() ?? await db.muthowifServicePrice.create({ data: {} })
  await db.pricePoint.deleteMany({ where: { ownerType: 'muthowif' } }) // tarif singleton bawaan migrasi lama bisa sudah punya titik harga
  await setLegacy(db, 'muthowif_service_price', muth.id, { price: 450_000 }); ids.muthowif_service_price = muth.id
  const haji = await db.hajiProduct.create({ data: { name: 'HJ', hajiType: 'reguler', year: 2090 } })
  await setLegacy(db, 'haji_products', haji.id, { price: 4_200_000 }); ids.haji_products = haji.id
  const pkg = await db.package.create({ data: { name: 'P' } })
  await setLegacy(db, 'packages', pkg.id, { price: 6_600_000 }); ids.packages = pkg.id
  const tour = await db.tourPackage.create({ data: { name: 'Z' } })
  await setLegacy(db, 'tour_packages', tour.id, { price: 350_000 }); ids.tour_packages = tour.id
  const visa = await db.visaProduct.create({ data: { name: 'V', visaType: 'Umroh' } })
  await setLegacy(db, 'visa_products', visa.id, { price: 2_500_000, durationFeeRules: [{ minDays: 1, maxDays: 14, fee: 2_500_000 }] }); ids.visa_products = visa.id
  const cat = await db.cateringOption.create({ data: { name: 'K', boardType: 'full_board', menuStyle: 'asian' } })
  await setLegacy(db, 'catering_options', cat.id, { pricePerPersonRegular: 100_000, pricePerPersonRamadan: 150_000, pricePerPersonHajj: 250_000 }); ids.catering_options = cat.id
  if (withPoints) {
    const make: Array<[string, string, number, string?, string?]> = [
      ['flight', flight.id, 23_000_000, '', 'person'], ['hotel', room.id, 1_200_000, '', 'room_night'], ['hotel_service', svc.id, 50_000, '', 'service'], ['transport', tp.id, 6_000_000, '', 'vehicle'],
      ['muthowif', muth.id, 450_000, '', 'person_day'], ['haji', haji.id, 4_200_000], ['package', pkg.id, 6_600_000], ['tour_package', tour.id, 350_000],
      ['visa', visa.id, 2_500_000, 'days:1-14', 'person'],
      ['catering', cat.id, 100_000, 'season:regular', 'person_day'], ['catering', cat.id, 150_000, 'season:ramadan', 'person_day'], ['catering', cat.id, 250_000, 'season:hajj', 'person_day'],
    ]
    for (const [t, id, sell, vk, unit] of make) {
      const table = Object.entries(ids).find(([, v]) => v === id)?.[0]
      if (skip && table === skip && !(t === 'catering' && vk !== 'season:ramadan')) continue
      await point(db, t, id, sell, vk ?? '', unit ?? 'package')
    }
  }
  return ids
}

console.log('== skenario ==')

await t('semua harga lama punya titik harga → berhasil: SEMUA kolom lama hilang, titik harga utuh', async () => {
  const r = await scenarioWith(db => world(db, true))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  assert.deepEqual(await columnsLeft(r.name), [])
  assert.equal(Number((await query(r.name, `select count(*)::int as n from price_points `))[0]!.n), 12)
})
for (const [table] of [...new Set(LEGACY_COLUMNS.map(([t]) => t))].filter(t => t !== 'visa_applications').map(t => [t])) {
  await t(`FAIL-CLOSED + ATOMIK: harga lama di ${table} tanpa titik harga → migrasi berhenti, SEMUA kolom lama tetap ada, tak ada yang berubah`, async () => {
    const r = await scenarioWith(db => world(db, true, table))
    assert.notEqual(r.code, 0, 'harga lama tanpa titik harga harus membatalkan migrasi')
    assert.match(r.out, new RegExp(`Kontraksi harga dibatalkan.*${table}`))
    assert.equal((await columnsLeft(r.name)).length, LEGACY_COLUMNS.length, 'transaksi dibatalkan: tak satu kolom pun boleh hilang')
    assert.equal(Number((await query(r.name, `select count(*)::int as n from price_points`))[0]!.n), 11, 'titik harga tak tersentuh (12 dibuat, satu sengaja dilewati)')
  })
}
await t('harga lama bernilai 0 tanpa titik harga → tidak menghalangi (tak ada yang hilang)', async () => {
  const r = await scenarioWith(async db => {
    const haji = await db.hajiProduct.create({ data: { name: 'HJ0', hajiType: 'reguler', year: 2091 } })
    const cat = await db.cateringOption.create({ data: { name: 'K0', boardType: 'full_board', menuStyle: 'asian' } })
    return { haji: haji.id, cat: cat.id }
  })
  assert.equal(r.code, 0, r.out.slice(-400)); assert.deepEqual(await columnsLeft(r.name), [])
})
await t('Visa: hanya tier ber-fee > 0 yang wajib bertitik — fee 0 saja, `price` tanpa tier, dan durationFeeRules bukan array TIDAK menghalangi; tier ber-fee > 0 tanpa titik membatalkan', async () => {
  const okCase = await scenarioWith(async db => {
    const v1 = await db.visaProduct.create({ data: { name: 'V1', visaType: 'Umroh' } })
    await setLegacy(db, 'visa_products', v1.id, { price: 1_000_000, durationFeeRules: [{ minDays: 1, maxDays: 14, fee: 0 }] })   // fee 0 saja
    const v2 = await db.visaProduct.create({ data: { name: 'V2', visaType: 'Umroh' } })
    await setLegacy(db, 'visa_products', v2.id, { price: 2_000_000, durationFeeRules: [] })                                       // price tanpa tier (cache basi)
    const v3 = await db.visaProduct.create({ data: { name: 'V3', visaType: 'Umroh' } })
    await setLegacy(db, 'visa_products', v3.id, { price: 1, durationFeeRules: { bukan: 'array' } })                              // bukan array
    return { v1: v1.id, v2: v2.id, v3: v3.id }
  })
  assert.equal(okCase.code, 0, okCase.out.slice(-500)); assert.deepEqual(await columnsLeft(okCase.name), [])
  const bad = await scenarioWith(async db => {
    const v = await db.visaProduct.create({ data: { name: 'V', visaType: 'Umroh' } })
    await setLegacy(db, 'visa_products', v.id, { price: 1_000_000, durationFeeRules: [{ minDays: 1, maxDays: 14, fee: 0 }, { minDays: 15, maxDays: 30, fee: 1_500_000 }] })
    return { v: v.id }
  })
  assert.notEqual(bad.code, 0); assert.match(bad.out, /visa_products/); assert.equal((await columnsLeft(bad.name)).length, LEGACY_COLUMNS.length)
})
await t('katering diperiksa PER MUSIM: musim berharga tanpa titik membatalkan walau musim lain sudah bertitik', async () => {
  const r = await scenarioWith(async db => {
    const cat = await db.cateringOption.create({ data: { name: 'K', boardType: 'full_board', menuStyle: 'asian' } })
    await setLegacy(db, 'catering_options', cat.id, { pricePerPersonRegular: 100_000, pricePerPersonRamadan: 150_000 })
    await point(db, 'catering', cat.id, 100_000, 'season:regular', 'person_day')
    return { cat: cat.id }
  })
  assert.notEqual(r.code, 0); assert.match(r.out, /catering_options/); assert.equal((await columnsLeft(r.name)).length, LEGACY_COLUMNS.length)
})
await t('riwayat kurs/vendor beku Visa dipindah ke snapshot (hanya yang kosong); snapshot yang sudah membawa jejak tak diubah; trigger beku AKTIF lagi sesudahnya', async () => {
  const r = await scenarioWith(async db => {
    const user = await db.user.create({ data: { email: `m${Date.now()}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
    const visa = await db.visaProduct.create({ data: { name: 'V', visaType: 'Umroh' } })
    const bk = await db.booking.create({ data: { bookingCode: `K${Date.now()}`, userId: user.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: 3_000_000 }, select: { id: true } })
    const mk = async (hist: { fx: string[]; vendor: string[] } | null, snapVendors: string[]) => {
      const pil = await db.bookingPilgrim.create({ data: { bookingId: bk.id, fieldValues: {} } })
      const va = await db.visaApplication.create({ data: { bookingPilgrimId: pil.id, visaProductId: visa.id, visaType: 'Umroh' } })
      if (hist) await setLegacy(db, 'visa_applications', va.id, { exchangeRateIdsUsed: hist.fx, vendorIdsUsed: hist.vendor })
      // SQL mentah: klien Prisma proyek mengenal kolom snapshot yang lebih baru (rekomendasi, Fase 8A) daripada DB pra-migrasi ini.
      await db.$executeRawUnsafe(`INSERT INTO price_snapshots (id, "bookingId", "itemType", "itemId", "itemLabel", "itemQty", description, qty, unit, "unitSellIdr", "totalSellIdr", mode, "vendorIds") VALUES (gen_random_uuid()::text, '${bk.id}', 'visa', '${va.id}', 'Visa', 1, 'Visa', 1, 'person', 1000000, 1000000, 'auto', '${JSON.stringify(snapVendors)}'::jsonb)`)
      return va.id
    }
    const empty = await mk({ fx: ['rate-1'], vendor: ['vendor-1'] }, [])        // snapshot kosong → diisi dari kolom lama
    const kept = await mk({ fx: ['rate-x'], vendor: ['vendor-x'] }, ['vendor-asli']) // sudah membawa jejak → tak diubah
    const none = await mk(null, [])                                               // tak ada riwayat lama → tetap kosong
    return { bk: bk.id, empty, kept, none }
  })
  assert.equal(r.code, 0, r.out.slice(-500))
  const rows = await query(r.name, `select "itemId" as id, "fxRateIds" as fx, "vendorIds" as v from price_snapshots where "itemType" = 'visa'`)
  const by = (id: string) => rows.find(x => x.id === id)!
  assert.deepEqual([by(r.ids.empty!).fx, by(r.ids.empty!).v], [['rate-1'], ['vendor-1']])
  assert.deepEqual([by(r.ids.kept!).fx, by(r.ids.kept!).v], [[], ['vendor-asli']])
  assert.deepEqual([by(r.ids.none!).fx, by(r.ids.none!).v], [[], []])
  const upd = exec(r.name, `UPDATE price_snapshots SET "itemLabel" = 'x';`)
  assert.notEqual(upd.code, 0, 'trigger beku harus aktif lagi setelah migrasi'); assert.match(upd.out, /beku/)
})
await t('tabel kosong aman', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0, r.out.slice(-300)); assert.deepEqual(await columnsLeft(r.name), [])
})

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
