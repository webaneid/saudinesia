// Uji migrasi snapshot harga (prisma/migrations/20261028190000_price_snapshots; docs/arsitektur-harga-terpadu.md §17, Fase 4).
// Booking lama diberi satu baris `main` per item (hanya jual; HPP beku Visa ikut), selisih terhadap total lama ditutup baris penyesuaian sehingga invarian
// I4 (total = Σ snapshot) berlaku untuk SEMUA booking; aturan bentuk dan beku dijaga DB; tanpa drift skema (uji drift terbaru berada di berkas ini).
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
import { legacyInsert } from './lib/legacyInsert'
import { legacyUser } from './lib/legacyUser'

await assertThrowawayDb()

const MIGRATION = '20261028190000_price_snapshots'
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
const mkUser = (db: PrismaClient) => legacyUser(db, { email: `m${Date.now()}${++seq}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() })
const mkBooking = (db: PrismaClient, userId: string, totalAmount: number) =>
  db.booking.create({ data: { bookingCode: `MIG${Date.now()}${++seq}`, userId, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount }, select: { id: true } })

/** Satu booking berisi ketujuh tipe item; total = Σ item persis (tanpa selisih). */
async function fullWorld(db: PrismaClient, withGap = 0) {
  const user = await mkUser(db)
  const hotel = await db.hotel.create({ data: { name: 'Hotel M', city: 'makkah' } })
  const rt = await db.roomType.create({ data: { name: `Tipe ${Date.now()}${++seq}`, defaultCapacity: 2 } })
  const period = await db.hotelPricePeriod.create({ data: { hotelId: hotel.id, periodStart: new Date('2090-01-01'), periodEnd: new Date('2090-12-31') } })
  const sch = await db.hotelRoomSchedule.create({ data: { periodId: period.id, roomTypeId: rt.id, totalQuota: 5 } })
  const trip = await db.transportTrip.create({ data: { name: 'Trip M', origin: 'A', destination: 'B' } })
  const vehicle = await db.transportVehicle.create({ data: { name: 'Bus M', vehicleType: 'bus', capacity: 40 } })
  const pricing = await db.transportPricing.create({ data: { tripId: trip.id, vehicleId: vehicle.id } })
  const quota = await db.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date('2027-06-02'), totalSeats: 100 } })
  const cat = await db.cateringOption.create({ data: { name: 'Katering M', boardType: 'full_board', menuStyle: 'asian' } })
  const tour = await db.tourPackage.create({ data: { name: 'Ziarah M' } })
  const haji = await db.hajiProduct.create({ data: { name: 'Haji M', hajiType: 'reguler', year: 2090 } })
  const visa = await db.visaProduct.create({ data: { name: 'Umroh Reguler', visaType: 'Umroh' } })
  const bk = await mkBooking(db, user.id, 7_200_000 + 500_000 + 3_000_000 + 900_000 + 2_000_000 + 12_000_000 + 1_800_000 + withGap)
  const d = (s: string) => new Date(s)
  const bh = await legacyInsert(db, 'booking_hotels', { bookingId: bk.id, hotelRoomScheduleId: sch.id, checkIn: d('2027-06-01'), checkOut: d('2027-06-04'), nights: 3, numRooms: 2, numGuests: 4, pricePerNight: 1_200_000, totalPrice: 7_200_000 })
  const bt = await legacyInsert(db, 'booking_transports', { bookingId: bk.id, transportQuotaId: quota.id, travelDate: d('2027-06-02'), numPassengers: 10, unitPrice: 500_000, totalPrice: 500_000 })
  const bm = await legacyInsert(db, 'booking_muthowif', { bookingId: bk.id, startDate: d('2027-06-01'), endDate: d('2027-06-04'), numDays: 3, numPeople: 5, totalPrice: 3_000_000 })
  const bc = await db.bookingCatering.create({ data: { bookingId: bk.id, cateringOptionId: cat.id, startDate: d('2027-06-01'), endDate: d('2027-06-04'), numDays: 3, numPeople: 3, totalPrice: 900_000 } })
  const btp = await legacyInsert(db, 'booking_tour_packages', { bookingId: bk.id, tourPackageId: tour.id, tourDate: d('2027-06-02'), numPeople: 4, totalPrice: 2_000_000 })
  const bj = await legacyInsert(db, 'booking_haji', { bookingId: bk.id, hajiProductId: haji.id, numPersons: 2, totalPrice: 12_000_000 })
  const pil = await db.bookingPilgrim.create({ data: { bookingId: bk.id, fieldValues: {} } })
  const va = await db.visaApplication.create({ data: { bookingPilgrimId: pil.id, visaProductId: visa.id, visaType: 'Umroh', selectedDurationDays: 30 }, select: { id: true } })
  await setLegacy(db, 'visa_applications', va.id, { hppSnapshotRupiah: 1_500_000, sellPriceSnapshot: 1_800_000 })
  return { booking: bk.id, bh: bh.id, bt: bt.id, bm: bm.id, bc: bc.id, btp: btp.id, bj: bj.id, va: va.id, sch: sch.id }
}

console.log('== skenario ==')

await t('booking lama: tiap item jadi SATU baris main (judul/rincian/qty/jual benar), Visa membawa HPP beku; total = Σ snapshot, tanpa baris penyesuaian', async () => {
  const r = await scenarioWith(db => fullWorld(db))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const rows = await snaps(r.name, r.ids.booking!)
  assert.deepEqual(rows.map(x => [x.t, x.k, x.label, x.iq, x.sell, x.cost]), [
    ['catering', 'main', 'Katering M', 3, 900_000, null],
    ['haji', 'main', 'Haji M', 2, 12_000_000, null],
    ['hotel', 'main', 'Hotel M — ' + String(rows.find(x => x.t === 'hotel')!.label).split(' — ')[1], 2, 7_200_000, null],
    ['muthowif', 'main', 'Layanan Muthowif', 5, 3_000_000, null],
    ['tourPackage', 'main', 'Ziarah M', 4, 2_000_000, null],
    ['transport', 'main', 'Trip M (Bus M)', 10, 500_000, null],
    ['visa', 'main', 'Visa Umroh Reguler', 1, 1_800_000, 1_500_000],
  ])
  assert.equal(rows.find(x => x.t === 'hotel')!.detail, '01-06-2027 – 04-06-2027 · 3 malam · 2 kamar')
  assert.equal(rows.find(x => x.t === 'visa')!.detail, '30 hari')
  const sum = await query(r.name, `select (select "totalAmount"::float from bookings where id = '${r.ids.booking}') as total, (select sum("totalSellIdr")::float from price_snapshots where "bookingId" = '${r.ids.booking}') as s`)
  assert.equal(sum[0]!.total, sum[0]!.s)
})
await t('total lama ≠ Σ item (era total-dari-klien): selisih ditutup baris penyesuaian tingkat-booking, positif maupun negatif; booking tanpa item dan tanpa total aman', async () => {
  const r = await scenarioWith(async db => {
    const w = await fullWorld(db, 250_000)       // total lebih besar 250.000 dari Σ item
    const w2 = await fullWorld(db, -100_000)     // lebih kecil 100.000
    const u = await mkUser(db)
    const empty = await mkBooking(db, u.id, 1000) // tanpa item sama sekali
    const zero = await mkBooking(db, u.id, 0)
    return { a: w.booking, b: w2.booking, empty: empty.id, zero: zero.id }
  })
  assert.equal(r.code, 0, r.out.slice(-500))
  assert.deepEqual((await snaps(r.name, r.ids.a!)).filter(x => x.k === 'penyesuaian').map(x => [x.t, x.sell]), [['booking', 250_000]])
  assert.deepEqual((await snaps(r.name, r.ids.b!)).filter(x => x.k === 'penyesuaian').map(x => [x.t, x.sell]), [['booking', -100_000]])
  assert.deepEqual((await snaps(r.name, r.ids.empty!)).map(x => [x.t, x.k, x.sell]), [['booking', 'penyesuaian', 1000]])
  assert.deepEqual(await snaps(r.name, r.ids.zero!), [])
  const bad = await query(r.name, `select count(*)::int as n from bookings b where b."totalAmount" <> coalesce((select sum("totalSellIdr") from price_snapshots s where s."bookingId" = b.id), 0)`)
  assert.equal(bad[0]!.n, 0, 'invarian I4 berlaku untuk SEMUA booking lama')
})
await t('Visa tanpa HPP (0) → modal null; visa tanpa harga beku tidak dibuatkan baris', async () => {
  const r = await scenarioWith(async db => {
    const w = await fullWorld(db)
    await setLegacy(db, 'visa_applications', w.va!, { hppSnapshotRupiah: 0 })
    const u = await mkUser(db)
    const bk = await mkBooking(db, u.id, 0)
    const pil = await db.bookingPilgrim.create({ data: { bookingId: bk.id, fieldValues: {} } })
    await db.visaApplication.create({ data: { bookingPilgrimId: pil.id, visaType: 'Umroh' }, select: { id: true } })
    return { a: w.booking, b: bk.id }
  })
  assert.equal(r.code, 0, r.out.slice(-400))
  assert.equal((await snaps(r.name, r.ids.a!)).find(x => x.t === 'visa')!.cost, null)
  assert.deepEqual(await snaps(r.name, r.ids.b!), [])
})
await t('aturan bentuk dijaga DB: negatif non-penyesuaian, mode liar, total ≠ satuan×qty, modal setengah terisi, qty 0, duplikat kunci → semua ditolak; penyesuaian negatif boleh', async () => {
  const r = await scenarioWith(async db => { const w = await fullWorld(db); return { booking: w.booking, bh: w.bh } })
  assert.equal(r.code, 0, r.out.slice(-400))
  // Sisipkan satu baris snapshot; `extra` = kolom tambahan (nama → nilai SQL). Kembalikan kode keluar psql (0 = diterima).
  const ins = (v: { qty: string; mode: string; unitSell: string; totalSell: string; lineKey?: string; extra?: Record<string, string> }) => {
    const extra = Object.entries(v.extra ?? {})
    const cols = ['id', '"bookingId"', '"itemType"', '"itemId"', '"lineKey"', '"itemLabel"', '"itemQty"', 'description', 'qty', 'unit', 'mode', '"unitSellIdr"', '"totalSellIdr"', ...extra.map(([k]) => `"${k}"`)]
    const vals = [`'c${++seq}'`, `'${r.ids.booking}'`, `'x'`, `'i${seq}'`, `'${v.lineKey ?? 'main'}'`, `'L'`, '1', `'D'`, v.qty, `'item'`, `'${v.mode}'`, v.unitSell, v.totalSell, ...extra.map(([, x]) => x)]
    return exec(r.name, `INSERT INTO price_snapshots (${cols.join(', ')}) VALUES (${vals.join(', ')});`).code
  }
  assert.notEqual(ins({ qty: '2', mode: 'auto', unitSell: '-5', totalSell: '-10' }), 0, 'jual negatif di baris non-penyesuaian')
  assert.notEqual(ins({ qty: '1', mode: 'liar', unitSell: '5', totalSell: '5' }), 0, 'mode liar')
  assert.notEqual(ins({ qty: '2', mode: 'auto', unitSell: '5', totalSell: '9' }), 0, 'total ≠ satuan × qty')
  assert.notEqual(ins({ qty: '2', mode: 'auto', unitSell: '5', totalSell: '10', extra: { unitCostIdr: '3' } }), 0, 'modal satuan terisi tanpa total modal')
  assert.notEqual(ins({ qty: '0', mode: 'auto', unitSell: '5', totalSell: '0' }), 0, 'qty 0')
  assert.notEqual(ins({ qty: '2', mode: 'auto', unitSell: '5', totalSell: '10', extra: { unitCostIdr: '-1', totalCostIdr: '-2' } }), 0, 'modal negatif')
  assert.equal(ins({ qty: '2', mode: 'auto', unitSell: '5', totalSell: '10', extra: { unitCostIdr: '3', totalCostIdr: '6' } }), 0, 'baris valid dengan modal diterima')
  assert.equal(ins({ qty: '1', mode: 'manual', unitSell: '-300', totalSell: '-300', lineKey: 'penyesuaian' }), 0, 'penyesuaian negatif diterima')
  assert.notEqual(exec(r.name, `INSERT INTO price_snapshots (id, "bookingId", "itemType", "itemId", "lineKey", "itemLabel", "itemQty", description, qty, unit, mode, "unitSellIdr", "totalSellIdr") VALUES ('dup1', '${r.ids.booking}', 'hotel', '${r.ids.bh}', 'main', 'L', 1, 'D', 1, 'item', 'auto', 1, 1);`).code, 0, 'kunci (itemType,itemId,lineKey) unik')
})
await t('BEKU: UPDATE apa pun ditolak trigger (jual, modal, label); DELETE booking lewat cascade tetap menghapus snapshot-nya', async () => {
  const r = await scenarioWith(async db => ({ booking: (await fullWorld(db)).booking }))
  assert.equal(r.code, 0, r.out.slice(-400))
  for (const set of [`"totalSellIdr" = 1, "unitSellIdr" = 1`, `"itemLabel" = 'diubah'`, `"mode" = 'manual'`]) {
    const u = exec(r.name, `UPDATE price_snapshots SET ${set} WHERE "bookingId" = '${r.ids.booking}';`)
    assert.notEqual(u.code, 0, `UPDATE ${set} harus ditolak`)
    assert.match(u.out, /beku/)
  }
  assert.ok(Number((await query(r.name, `select count(*)::int as n from price_snapshots where "bookingId" = '${r.ids.booking}'`))[0]!.n) > 0)
  assert.equal(exec(r.name, `DELETE FROM bookings WHERE id = '${r.ids.booking}';`).code, 0, 'hapus booking harus lolos')
  assert.equal(Number((await query(r.name, `select count(*)::int as n from price_snapshots where "bookingId" = '${r.ids.booking}'`))[0]!.n), 0, 'cascade menghapus snapshot')
})
await t('tabel kosong aman', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0, r.out.slice(-300))
  assert.equal(Number((await query(r.name, `select count(*)::int as n from price_snapshots`))[0]!.n), 0)
})
// Uji drift skema ada di migrasi TERBARU (scripts/test-pricing-rule-default-margin-migration.ts) — di sini skema sudah lebih maju (kolom harga lama dihapus).

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
