// Uji migrasi pemilik manual-only (prisma/migrations/20261028170000_price_points_manual_owners; docs/arsitektur-harga-terpadu.md §16, Fase 3).
// Katering (tiga musim) dan Layanan Hotel: harga yang sudah diisi admin disalin sebagai HARGA MANUAL titik harga (modal NULL), harga 0 dilewati, idempoten, tidak
// menimpa titik yang sudah ada.
//
// PENGAMAN: membuat/menghapus database sementara `<db>_tmp_*` di server yang sama — menolak jalan kecuali DATABASE_URL adalah DB uji.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { LEGACY_DEFAULTS_SQL, setLegacy } from './lib/legacyPriceColumns'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

const MIGRATION = '20261028170000_price_points_manual_owners'
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
const points = (name: string) => query(name, `select "ownerType" as t, "variantKey" as v, unit, "costIdr"::float as cost, "autoSellIdr"::float as auto, "manualSellIdr"::float as manual, "sellIdr"::float as sell from price_points where "ownerType" in ('catering','hotel_service') order by "ownerType", "ownerId", "variantKey"`)

async function scenarioWith(fixtures: (db: PrismaClient) => Promise<Record<string, string>>) {
  const name = `${mainName}${suffix}_s${++n}`
  await newDb(name, baseName)
  const db = new PrismaClient({ datasourceUrl: dbUrl(name) })
  let ids: Record<string, string>
  try { ids = await fixtures(db) } finally { await db.$disconnect() }
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ids, ...res }
}
async function world(db: PrismaClient) {
  const c = await db.cateringOption.create({ data: { name: 'K', boardType: 'full_board', menuStyle: 'asian' } })
  await setLegacy(db, 'catering_options', c.id, { pricePerPersonRegular: 100_000, pricePerPersonRamadan: 150_000, pricePerPersonHajj: 0 })
  const hotel = await db.hotel.create({ data: { name: 'H', city: 'makkah' } })
  const s1 = await db.hotelService.create({ data: { hotelId: hotel.id, serviceName: 'Laundry' } })
  await setLegacy(db, 'hotel_services', s1.id, { price: 50_000 })
  const s0 = await db.hotelService.create({ data: { hotelId: hotel.id, serviceName: 'Gratis' } })
  return { c: c.id, s1: s1.id, s0: s0.id }
}

console.log('== skenario ==')

await t('katering: tiap musim berharga > 0 jadi titik MANUAL (modal NULL, auto NULL); musim 0 dilewati; layanan hotel satu varian, harga 0 dilewati', async () => {
  const r = await scenarioWith(world)
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const p = await points(r.name)
  assert.deepEqual(p.filter(x => x.t === 'catering').map(x => [x.v, x.unit, x.cost, x.auto, x.manual, x.sell]), [['season:ramadan', 'person_day', null, null, 150_000, 150_000], ['season:regular', 'person_day', null, null, 100_000, 100_000]])
  assert.deepEqual(p.filter(x => x.t === 'hotel_service').map(x => [x.v, x.unit, x.manual, x.sell]), [['', 'service', 50_000, 50_000]])
})
await t('titik yang sudah ada tidak ditimpa; menjalankan SQL kedua kali tidak mengubah apa pun (idempoten)', async () => {
  const r = await scenarioWith(async db => {
    const ids = await world(db)
    await db.pricePoint.create({ data: { ownerType: 'catering', ownerId: ids.c!, variantKey: 'season:regular', unit: 'person_day', manualSellIdr: 120_000, sellIdr: 120_000 } })
    return ids
  })
  assert.equal(r.code, 0, r.out.slice(-400))
  const before = await points(r.name)
  assert.equal(before.find(x => x.v === 'season:regular')!.sell, 120_000)
  const again = exec(r.name, readFileSync(join(root, 'prisma/migrations', MIGRATION, 'migration.sql'), 'utf8'))
  assert.equal(again.code, 0, again.out.slice(-300))
  assert.deepEqual(await points(r.name), before)
})
await t('tabel kosong aman', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0, r.out.slice(-300)); assert.equal((await points(r.name)).length, 0)
})
// Uji drift skema ada di migrasi TERBARU (scripts/test-price-snapshots-migration.ts) — di sini skema sudah lebih maju dari migrasi yang diuji.

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
