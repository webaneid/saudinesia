// Uji migrasi inti engine booking (prisma/migrations/20261106090000_booking_engine_core, docs/arsitektur-booking-engine-v2.md §10.2): aturan visa string lama → objek,
// nilai aturan tak dikenal → BERHENTI; paket hotel `included` berjumlah kamar → BERHENTI (makna harga berubah ke per orang), yang tidak included dibuang; kolom pelonggaran pelanggan;
// tabel booking_packages dengan CHECK + FK; atomik; dan DB hasil SEMUA migrasi = schema.prisma (uji drift TERBARU berada di berkas ini).
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

const MIGRATION = '20261106090000_booking_engine_core'
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
const tmp = mkdtempSync(join(tmpdir(), 'engine-core-mig-'))
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
const colExists = async (name: string, table: string, col: string) => Number((await one(name, `select count(*)::int as n from information_schema.columns where table_name = '${table}' and column_name = '${col}'`)).n) === 1
const visaRules = async (name: string) => (await query(name, `select name, "requiredComponents" as rc from visa_products order by name`)).map(r => [r.name, r.rc])
const VISA = (name: string, rc: string) => `INSERT INTO visa_products (id, name, "visaType", "requiredComponents") VALUES (gen_random_uuid(), '${name}', 'Umroh', '${rc}'::jsonb);`
const PKG = (name: string, makkah: string, rooms: string) => `INSERT INTO packages (id, name, "hotelMakkahMode", "includedHotelMakkahNumRooms") VALUES (gen_random_uuid(), '${name}', '${makkah}'::price_variable_mode, ${rooms});`

console.log('== skenario ==')

await t('aturan visa: string lama → objek {type}; objek yang sudah benar tetap; daftar kosong tetap kosong; duplikat dirapikan', async () => {
  const r = await scenario([
    VISA('V1', '["hotel","transport"]'), VISA('V2', '[]'), VISA('V3', '[{"type":"flight"}]'), VISA('V4', '["hotel","hotel"]'),
  ].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const rows = Object.fromEntries(await visaRules(r.name))
  assert.deepEqual(new Set((rows.V1 as Array<{ type: string }>).map(x => x.type)), new Set(['hotel', 'transport']))
  assert.deepEqual(rows.V2, []); assert.deepEqual(rows.V3, [{ type: 'flight' }]); assert.deepEqual(rows.V4, [{ type: 'hotel' }])
})

for (const [label, rc] of [['string tak dikenal', '["kapal"]'], ['objek bertipe liar', '[{"type":"bus"}]'], ['bukan array', '{"type":"hotel"}']] as const) {
  await t(`FAIL-CLOSED + ATOMIK: aturan visa ${label} → migrasi BERHENTI, tak ada kolom/tabel baru, data visa tak berubah`, async () => {
    const r = await scenario(VISA('VX', rc))
    assert.notEqual(r.code, 0, 'harus gagal')
    assert.match(r.out, /requiredComponents tak dikenal/)
    assert.equal(await colExists(r.name, 'users', 'allowVisaWithoutBundle'), false, 'atomik: langkah sebelumnya ikut batal')
    assert.equal(Number((await one(r.name, `select count(*)::int as n from information_schema.tables where table_name = 'booking_packages'`)).n), 0)
    assert.deepEqual((await visaRules(r.name))[0]![1], JSON.parse(rc))
  })
}

await t('FAIL-CLOSED: paket hotel INCLUDED berjumlah kamar → BERHENTI (harga kini per orang, tinjau manual); kolom lama tetap ada', async () => {
  const r = await scenario(PKG('P1', 'included', '2'))
  assert.notEqual(r.code, 0, 'harus gagal'); assert.match(r.out, /hotel included dengan jumlah kamar/)
  assert.equal(await colExists(r.name, 'packages', 'includedHotelMakkahNumRooms'), true)
  assert.equal(await colExists(r.name, 'packages', 'includedHotelMakkahOccupancy'), false)
})

await t('paket NON-included dengan sisa jumlah kamar → berhasil; kolom lama dibuang, isi kamar NULL; CHECK isi kamar 1–20', async () => {
  const r = await scenario([PKG('P2', 'none', '3'), PKG('P3', 'user_choice', 'NULL')].join('\n'))
  assert.equal(r.code, 0, r.out.slice(-500))
  assert.equal(await colExists(r.name, 'packages', 'includedHotelMakkahNumRooms'), false)
  assert.equal(await colExists(r.name, 'packages', 'includedHotelMadinahNumRooms'), false)
  assert.deepEqual((await query(r.name, `select name, "includedHotelMakkahOccupancy" as o from packages order by name`)).map(x => [x.name, x.o]), [['P2', null], ['P3', null]])
  const db = new PrismaClient({ datasourceUrl: dbUrl(r.name) })
  try {
    for (const bad of [0, 21]) await assert.rejects(() => db.$executeRawUnsafe(`UPDATE packages SET "includedHotelMakkahOccupancy" = ${bad} WHERE name = 'P2'`), /packages_hotel_occupancy|check/i)
    await db.$executeRawUnsafe(`UPDATE packages SET "includedHotelMakkahOccupancy" = 4 WHERE name = 'P2'`)
  } finally { await db.$disconnect() }
})

await t('pelanggan: allowVisaWithoutBundle NOT NULL default false untuk akun lama; booking_packages: CHECK bentuk, FK paket/jadwal Restrict, booking Cascade', async () => {
  // DB PRA-migrasi: SQL mentah — klien proyek sudah mengenal kolom yang belum ada di sana.
  const r = await scenario(`INSERT INTO users (id, email, "passwordHash", "fullName", role, "isActive", "updatedAt") VALUES (gen_random_uuid(), 'lama@example.test', 'x', 'Lama', 'pilgrim', true, now());`)
  assert.equal(r.code, 0, r.out.slice(-500))
  assert.deepEqual((await query(r.name, `select "allowVisaWithoutBundle" as a from users`)).map(x => x.a), [false])
  const fks = await query(r.name, `select conname, confdeltype from pg_constraint where conrelid = 'booking_packages'::regclass and contype = 'f' order by conname`)
  assert.deepEqual(fks.map(f => [f.conname, f.confdeltype]), [['booking_packages_bookingId_fkey', 'c'], ['booking_packages_flightScheduleId_fkey', 'r'], ['booking_packages_packageId_fkey', 'r']])
  const db = new PrismaClient({ datasourceUrl: dbUrl(r.name) })
  try {
    const u = await seedUser(db)
    await db.$executeRawUnsafe(`INSERT INTO bookings (id, "bookingCode", "userId", season, "totalAmount", "updatedAt") VALUES ('c0000000-0000-4000-8000-000000000001', 'K1', '${u.id}', 'regular', 0, now())`)
    await db.$executeRawUnsafe(`INSERT INTO packages (id, name) VALUES ('c0000000-0000-4000-8000-0000000000aa', 'PK')`)
    const ins = (vals: string) => db.$executeRawUnsafe(`INSERT INTO booking_packages (id, "bookingId", "packageId", "departureDate", "returnDate", "numPeople", choices, "totalPrice") VALUES (gen_random_uuid(), 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000aa', ${vals})`)
    await ins(`'2090-06-01', '2090-06-10', 2, '{}', 100`)
    for (const bad of [`'2090-06-01', '2090-06-10', 0, '{}', 100`, `'2090-06-10', '2090-06-01', 1, '{}', 100`, `'2090-06-01', '2090-06-10', 1, '{}', -1`, `'2090-06-01', '2090-06-10', 1, '[]', 100`]) {
      await assert.rejects(() => ins(bad), /booking_packages_shape|check/i, bad)
    }
    await assert.rejects(() => db.$executeRawUnsafe(`DELETE FROM packages WHERE id = 'c0000000-0000-4000-8000-0000000000aa'`), /foreign key|violates/i, 'paket yang pernah dipesan tak bisa dihapus (Restrict)')
    await db.$executeRawUnsafe(`DELETE FROM bookings WHERE id = 'c0000000-0000-4000-8000-000000000001'`)
    assert.equal(Number((await db.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from booking_packages`))[0]!.n), 0, 'cascade dari booking')
  } finally { await db.$disconnect() }
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
