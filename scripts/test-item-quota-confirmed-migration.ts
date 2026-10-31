// Uji migrasi status kuota per baris (prisma/migrations/20261110090000_item_quota_confirmed, docs/arsitektur-booking-engine-v2.md §10.4 6b koreksi): kolom `quotaConfirmed`
// di tujuh tabel item, terisi TRUE hanya untuk baris milik booking yang sudah dikonfirmasi; dan DB hasil SEMUA migrasi = schema.prisma (uji drift TERBARU berada di berkas ini).
//
// PENGAMAN: membuat/menghapus database sementara `<db>_tmp_*` di server yang sama — menolak jalan kecuali DATABASE_URL adalah DB uji.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { assertThrowawayDb } from './lib/testDb'
import { legacyUser } from './lib/legacyUser'

await assertThrowawayDb()

const MIGRATION = '20261110090000_item_quota_confirmed'
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
const tmp = mkdtempSync(join(tmpdir(), 'quota-row-mig-'))
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
// Migrasi yang diuji DAN semua yang lebih baru (penguatan pascaaudit: settings_audit + CHECK) — supaya uji drift membandingkan DB hasil SEMUA migrasi.
for (const d of readdirSync(join(root, 'prisma/migrations'))) {
  if (d >= MIGRATION && !d.endsWith('.toml')) cpSync(join(root, 'prisma/migrations', d), join(tmp, 'migrations', d), { recursive: true })
}

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

const diff = (name: string) => run(dbUrl(name), ['migrate', 'diff', '--from-url', dbUrl(name), '--to-schema-datamodel', 'schema.prisma', '--exit-code'])
const q1 = async (name: string, sql: string) => (await query(name, sql))


async function seedUser(db: PrismaClient) {
  return legacyUser(db, { email: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() })
}
const one = async (name: string, sql: string) => (await query(name, sql))[0]!
const USER = `INSERT INTO users (id, email, "passwordHash", "fullName", role, "isActive", "updatedAt") VALUES ('d0000000-0000-4000-8000-000000000001', 'lama@example.test', 'x', 'Lama', 'pilgrim', true, now());`
const BOOKING = (code: string, status: string) => `INSERT INTO bookings (id, "bookingCode", "userId", status, season, "totalAmount", "updatedAt") VALUES (gen_random_uuid(), '${code}', 'd0000000-0000-4000-8000-000000000001', '${status}'::booking_status, 'regular', 1000, now());`

console.log('== skenario ==')

const BK = (id: string, code: string, confirmed: boolean) => `INSERT INTO bookings (id, "bookingCode", "userId", status, season, "totalAmount", "confirmedAt", "updatedAt") VALUES ('${id}', '${code}', 'd0000000-0000-4000-8000-000000000001', 'active', 'regular', 1000, ${confirmed ? 'now()' : 'NULL'}, now());`
const FL = (id: string, bookingId: string) => `INSERT INTO booking_flights (id, "bookingId", "flightScheduleId", "departureDate", "numPassengers", "unitPrice", "totalPrice") VALUES ('${id}', '${bookingId}', 'f0000000-0000-4000-8000-000000000001', '2090-06-10', 1, 1, 1);`
const SCHED = `INSERT INTO flight_routes (id, origin, destination) VALUES ('e0000000-0000-4000-8000-000000000001', 'CGK', 'JED');
INSERT INTO flight_schedules (id, "routeId", "departureFrom", "departureTo", "totalSeats") VALUES ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', '2090-06-01', '2090-06-30', 10);`

await t('BACKFILL: baris item booking TERKONFIRMASI → quotaConfirmed = true; booking belum dikonfirmasi → false; kolom ada di tujuh tabel item', async () => {
  const r = await scenario([USER, SCHED, BK('b1000000-0000-4000-8000-000000000001', 'Q1', true), BK('b2000000-0000-4000-8000-000000000002', 'Q2', false),
    FL('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'), FL('c2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002')].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  assert.deepEqual(await query(r.name, `select f."quotaConfirmed" as q, b."bookingCode" as c from booking_flights f join bookings b on b.id = f."bookingId" order by c`), [{ q: true, c: 'Q1' }, { q: false, c: 'Q2' }])
  const cols = await query(r.name, `select count(*)::int as n from information_schema.columns where column_name = 'quotaConfirmed' and table_name in ('booking_hotels','booking_transports','booking_muthowif','booking_tour_packages','booking_haji','booking_flights','booking_packages')`)
  assert.deepEqual(cols, [{ n: 7 }])
})

await t('tanpa drift: DB hasil SEMUA migrasi = schema.prisma', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0, r.out.slice(-300))
  const d = diff(r.name)
  assert.equal(d.code, 0, `drift skema:\n${d.out.slice(-800)}`)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────
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
