// Uji migrasi pembersihan (prisma/migrations/20261102090000_drop_group_and_booking_visa): modul Group Booking dan `booking_visa` yang tak pernah terpakai dibuang — FAIL-CLOSED: bila salah satu tabel/kolom
// berisi data, migrasi BERHENTI dan semuanya utuh (rollback); kosong → tabel/kolom/FK hilang; (uji drift terbaru dipindah ke test-invoice-settings-migration).
//
// PENGAMAN: membuat/menghapus database sementara `<db>_tmp_*` di server yang sama — menolak jalan kecuali DATABASE_URL adalah DB uji.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

const MIGRATION = '20261102090000_drop_group_and_booking_visa'
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

const q1 = async (name: string, sql: string) => (await query(name, sql))


// SQL mentah: klien Prisma proyek sudah tak mengenal tabel yang akan dibuang.
async function seedUser(db: PrismaClient) {
  return db.user.create({ data: { email: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
}
const exists = async (name: string, rel: string) => Number((await q1(name, `select count(*)::int as n from information_schema.tables where table_name = '${rel}'`))[0]!.n) === 1
const colExists = async (name: string) => Number((await q1(name, `select count(*)::int as n from information_schema.columns where table_name = 'bookings' and column_name = 'groupId'`))[0]!.n) === 1

console.log('== skenario ==')

await t('kosong (keadaan nyata): migrasi berhasil — tabel groups, group_members, booking_visa dan kolom bookings.groupId (beserta FK) hilang; tabel lain utuh', async () => {
  const r = await scenarioWith(async db => { const u = await seedUser(db); await db.booking.create({ data: { bookingCode: 'K1', userId: u.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: 1 }, select: { id: true } }); return {} })
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  assert.deepEqual([await exists(r.name, 'groups'), await exists(r.name, 'group_members'), await exists(r.name, 'booking_visa'), await colExists(r.name)], [false, false, false, false])
  assert.equal((await q1(r.name, `select conname from pg_constraint where conname = 'bookings_groupId_fkey'`)).length, 0)
  assert.equal(Number((await q1(r.name, `select count(*)::int as n from bookings`))[0]!.n), 1, 'baris booking utuh')
})
await t('FAIL-CLOSED: grup berisi data → migrasi BERHENTI dengan pesan jelas dan SEMUA tabel/kolom tetap ada (tak ada pembuangan diam-diam)', async () => {
  const r = await scenarioWith(async db => { const u = await seedUser(db); await db.$executeRawUnsafe(`INSERT INTO groups (id, "groupCode", "leaderUserId", "totalMembers") VALUES ('g1', 'GR-1', '${u.id}', 2)`); return {} })
  assert.notEqual(r.code, 0, 'migrasi harus gagal')
  assert.match(r.out, /berisi data|belum pernah dipakai/i)
})
await t('FAIL-CLOSED: group_members berisi data → berhenti', async () => {
  const r = await scenarioWith(async db => { const u = await seedUser(db); await db.$executeRawUnsafe(`INSERT INTO groups (id, "groupCode", "leaderUserId", "totalMembers") VALUES ('g2', 'GR-2', '${u.id}', 2)`); await db.$executeRawUnsafe(`INSERT INTO group_members (id, "groupId", status) VALUES ('m2', 'g2', 'invited')`); return {} })
  assert.notEqual(r.code, 0)
})
await t('FAIL-CLOSED: booking_visa berisi data → berhenti', async () => {
  const r = await scenarioWith(async db => {
    const u = await seedUser(db)
    const b = await db.booking.create({ data: { bookingCode: 'K3', userId: u.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: 1 }, select: { id: true } })
    const v = await db.visaProduct.create({ data: { name: 'V', visaType: 'Umroh' } })
    await db.$executeRawUnsafe(`INSERT INTO booking_visa (id, "bookingId", "visaProductId", "numPersons", "totalPrice") VALUES ('bv1', '${b.id}', '${v.id}', 1, 1)`)
    return {}
  })
  assert.notEqual(r.code, 0)
})
await t('FAIL-CLOSED: booking yang menunjuk grup (bookings.groupId terisi) → berhenti', async () => {
  const r = await scenarioWith(async db => {
    const u = await seedUser(db)
    await db.$executeRawUnsafe(`INSERT INTO groups (id, "groupCode", "leaderUserId", "totalMembers") VALUES ('g4', 'GR-4', '${u.id}', 2)`)
    const b = await db.booking.create({ data: { bookingCode: 'K4', userId: u.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: 1 }, select: { id: true } })
    await db.$executeRawUnsafe(`UPDATE bookings SET "groupId" = 'g4' WHERE id = '${b.id}'`)
    return {}
  })
  assert.notEqual(r.code, 0)
})
// Uji drift TERBARU kini di scripts/test-invoice-settings-migration.ts (migrasi terbaru).

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
