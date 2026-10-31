// Uji migrasi draf booking (prisma/migrations/20261107090000_booking_draft, docs/arsitektur-booking-engine-v2.md §10.3): ADITIF — booking lama utuh dengan draft NULL,
// CHECK "draft hanya selama status draft", visa_applications.plannedTravelDate DATE nullable; uji drift TERBARU pindah ke scripts/test-invoices-migration.ts.
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

const MIGRATION = '20261107090000_booking_draft'
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
const tmp = mkdtempSync(join(tmpdir(), 'booking-draft-mig-'))
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

await t('ADITIF: booking lama (aktif dan draf) utuh dengan draft NULL; kolom baru bertipe jsonb dan date, boleh kosong', async () => {
  const r = await scenario([USER, BOOKING('A1', 'active'), BOOKING('A2', 'draft')].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  assert.deepEqual((await query(r.name, `select "bookingCode" as c, status::text as s, draft from bookings order by "bookingCode"`)), [{ c: 'A1', s: 'active', draft: null }, { c: 'A2', s: 'draft', draft: null }])
  const cols = await query(r.name, `select table_name as t, column_name as c, data_type as d, is_nullable as nl from information_schema.columns where (table_name, column_name) in (('bookings','draft'), ('visa_applications','plannedTravelDate')) order by 1`)
  assert.deepEqual(cols, [{ t: 'bookings', c: 'draft', d: 'jsonb', nl: 'YES' }, { t: 'visa_applications', c: 'plannedTravelDate', d: 'date', nl: 'YES' }])
})

await t('CHECK: isi draf hanya boleh pada booking berstatus draft dan harus objek; terbit (status aktif) WAJIB mengosongkan draft', async () => {
  const r = await scenario([USER, BOOKING('B1', 'draft'), BOOKING('B2', 'active')].join('\n'))
  assert.equal(r.code, 0, r.out.slice(-300))
  const db = new PrismaClient({ datasourceUrl: dbUrl(r.name) })
  try {
    await db.$executeRawUnsafe(`UPDATE bookings SET draft = '{"items":[]}' WHERE "bookingCode" = 'B1'`)
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE bookings SET draft = '{"items":[]}' WHERE "bookingCode" = 'B2'`), /bookings_draft_only_in_draft|check/i)
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE bookings SET draft = '[]' WHERE "bookingCode" = 'B1'`), /bookings_draft_only_in_draft|check/i)
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE bookings SET status = 'active' WHERE "bookingCode" = 'B1'`), /bookings_draft_only_in_draft|check/i, 'terbit tanpa mengosongkan draft ditolak')
    await db.$executeRawUnsafe(`UPDATE bookings SET status = 'active', draft = NULL WHERE "bookingCode" = 'B1'`)
  } finally { await db.$disconnect() }
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
