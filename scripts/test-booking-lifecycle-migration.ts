// Uji migrasi siklus hidup booking (prisma/migrations/20261105090000_booking_lifecycle): tiap status v1 dipetakan ke siklus hidup baru, `confirmedAt`/`confirmedById` diisi dari pembayaran
// terkonfirmasi (atau updatedAt), tanggal acuan boleh kosong, dan CHECK draf terpasang (uji drift TERBARU kini di scripts/test-booking-engine-core-migration.ts).
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

const MIGRATION = '20261105090000_booking_lifecycle'
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
const tmp = mkdtempSync(join(tmpdir(), 'lifecycle-mig-'))
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


// SQL mentah: klien Prisma proyek sudah tak mengenal tabel yang akan dibuang.
async function seedUser(db: PrismaClient) {
  return legacyUser(db, { email: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() })
}
const exists = async (name: string, rel: string) => Number((await q1(name, `select count(*)::int as n from information_schema.tables where table_name = '${rel}'`))[0]!.n) === 1
const colExists = async (name: string) => Number((await q1(name, `select count(*)::int as n from information_schema.columns where table_name = 'bookings' and column_name = 'groupId'`))[0]!.n) === 1

async function seedBooking(db: PrismaClient, code: string) {
  const u = await legacyUser(db, { email: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() })
  await db.booking.create({ data: { bookingCode: code, userId: u.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: 1 } })
  return u.id
}


// Fixture pada DB PRA-migrasi lewat SQL mentah (klien proyek sudah tak mengenal enum lama).
type Seed = { code: string; status: string; confirmedPayAt?: string; payBy?: boolean }
async function seedOld(db: PrismaClient, rows: Seed[]) {
  const u = await legacyUser(db, { email: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() })
  const staff = await legacyUser(db, { email: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true, emailVerifiedAt: new Date() })
  for (const r of rows) {
    const id = `00000000-0000-4000-8000-${String(rows.indexOf(r) + 1).padStart(12, '0')}`
    await db.$executeRawUnsafe(`INSERT INTO bookings (id, "bookingCode", "userId", status, "departureDate", "returnDate", season, "totalAmount", "updatedAt") VALUES ('${id}', '${r.code}', '${u.id}', '${r.status}'::booking_status, '2027-06-01', '2027-06-10', 'regular', 1000, '2026-10-01 03:00:00')`)
    if (r.confirmedPayAt) await db.$executeRawUnsafe(`INSERT INTO payments (id, "bookingId", amount, method, status, "confirmedAt", "confirmedById") VALUES ('${id.replace(/^0{8}/, 'aaaaaaaa')}', '${id}', 1000, 'bank_transfer', 'confirmed', '${r.confirmedPayAt}', ${r.payBy ? `'${staff.id}'` : 'NULL'})`)
  }
  return { user: u.id, staff: staff.id }
}
const lc = async (name: string) => (await query(name, `select "bookingCode" as code, status::text as status, "confirmedAt" is not null as confirmed, to_char("confirmedAt" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as at, "confirmedById" is not null as by from bookings order by "bookingCode"`))

console.log('== skenario ==')

await t('tiap status v1 → siklus hidup baru; yang dulu confirmed/active/completed mendapat confirmedAt (pembayaran terakhir, atau updatedAt bila tanpa pembayaran) dan confirmedById; sisanya tidak', async () => {
  const r = await scenarioWith(async db => {
    await seedOld(db, [
      { code: 'A1', status: 'awaiting_payment' },
      { code: 'A2', status: 'payment_review' },
      { code: 'A3', status: 'confirmed', confirmedPayAt: '2026-10-05 08:00:00', payBy: true },
      { code: 'A4', status: 'active', confirmedPayAt: '2026-10-06 09:30:00' },
      { code: 'A5', status: 'completed' },
      { code: 'A6', status: 'cancelled' },
    ])
    return {}
  })
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  assert.deepEqual(await lc(r.name), [
    { code: 'A1', status: 'active', confirmed: false, at: null, by: false },
    { code: 'A2', status: 'active', confirmed: false, at: null, by: false },
    { code: 'A3', status: 'active', confirmed: true, at: '2026-10-05T08:00:00', by: true },
    { code: 'A4', status: 'active', confirmed: true, at: '2026-10-06T09:30:00', by: false },
    { code: 'A5', status: 'completed', confirmed: true, at: '2026-10-01T03:00:00', by: false },
    { code: 'A6', status: 'cancelled', confirmed: false, at: null, by: false },
  ])
})

await t('data lama utuh (jumlah booking/pembayaran/pengguna sama), enum baru berisi persis lima nilai, tipe lama hilang, default kolom = active', async () => {
  const r = await scenarioWith(async db => { await seedOld(db, [{ code: 'B1', status: 'confirmed', confirmedPayAt: '2026-10-05 08:00:00' }, { code: 'B2', status: 'awaiting_payment' }]); return {} })
  assert.equal(r.code, 0)
  assert.equal(Number((await query(r.name, `select count(*)::int as n from bookings`))[0]!.n), 2)
  assert.equal(Number((await query(r.name, `select count(*)::int as n from payments`))[0]!.n), 1)
  assert.equal(Number((await query(r.name, `select count(*)::int as n from users`))[0]!.n), 2)
  const labels = await query(r.name, `select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'booking_status' order by enumsortorder`)
  assert.deepEqual(labels.map(x => x.enumlabel), ['draft', 'active', 'completed', 'cancelled', 'expired'])
  assert.equal(Number((await query(r.name, `select count(*)::int as n from pg_type where typname = 'booking_status_old'`))[0]!.n), 0)
  const def = await query(r.name, `select column_default as d from information_schema.columns where table_name = 'bookings' and column_name = 'status'`)
  assert.match(String(def[0]!.d), /'active'/)
})

await t('tanggal acuan boleh kosong (draf); confirmedAt bertipe timestamptz; FK confirmedById SET NULL; CHECK: draf tak boleh terkonfirmasi', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0)
  const cols = await query(r.name, `select column_name, is_nullable, data_type from information_schema.columns where table_name = 'bookings' and column_name in ('departureDate','returnDate','confirmedAt') order by column_name`)
  assert.deepEqual(cols, [{ column_name: 'confirmedAt', is_nullable: 'YES', data_type: 'timestamp with time zone' }, { column_name: 'departureDate', is_nullable: 'YES', data_type: 'date' }, { column_name: 'returnDate', is_nullable: 'YES', data_type: 'date' }])
  const db = new PrismaClient({ datasourceUrl: dbUrl(r.name) })
  try {
    const u = await seedUser(db)
    await db.$executeRawUnsafe(`INSERT INTO bookings (id, "bookingCode", "userId", status, season, "totalAmount", "updatedAt") VALUES ('b0000000-0000-4000-8000-000000000001', 'D1', '${u.id}', 'draft', 'regular', 0, now())`) // tanpa tanggal: sah
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE bookings SET "confirmedAt" = now() WHERE "bookingCode" = 'D1'`), /bookings_draft_unconfirmed|check/i)
    await assert.rejects(() => db.$executeRawUnsafe(`INSERT INTO bookings (id, "bookingCode", "userId", status, season, "totalAmount", "confirmedAt", "updatedAt") VALUES ('b0000000-0000-4000-8000-000000000002', 'D2', '${u.id}', 'draft', 'regular', 0, now(), now())`), /bookings_draft_unconfirmed|check/i)
    await db.$executeRawUnsafe(`UPDATE bookings SET status = 'active', "confirmedAt" = now(), "confirmedById" = '${u.id}' WHERE "bookingCode" = 'D1'`)
    // FK SET NULL: menghapus staf yang mengonfirmasi tak menghapus booking
    const staff2 = await legacyUser(db, { email: `x${Date.now()}@example.test`, passwordHash: 'x', fullName: 'S2', role: 'admin', isActive: true })
    await db.$executeRawUnsafe(`UPDATE bookings SET "confirmedById" = '${staff2.id}' WHERE "bookingCode" = 'D1'`)
    await db.$executeRawUnsafe(`DELETE FROM users WHERE id = '${staff2.id}'`)
    const row = await db.$queryRawUnsafe<Array<{ n: number; c: boolean }>>(`select count(*)::int as n, bool_or("confirmedById" is null) as c from bookings where "bookingCode" = 'D1'`)
    assert.deepEqual([row[0]!.n, row[0]!.c], [1, true])
  } finally { await db.$disconnect() }
})

await t('enum lama tepat enam nilai dan semuanya tercakup pemetaan — tak ada baris yang bisa tak terpetakan (kalau enum lama bertambah, tes ini merah sampai pemetaan ditinjau)', async () => {
  const old = (await query(baseName, `select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'booking_status' order by enumsortorder`)).map(x => x.enumlabel)
  assert.deepEqual(old, ['awaiting_payment', 'payment_review', 'confirmed', 'active', 'completed', 'cancelled'])
})

// (uji drift TERBARU kini di scripts/test-booking-engine-core-migration.ts)

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
