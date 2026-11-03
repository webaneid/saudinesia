// Uji migrasi anggota paket/haji (prisma/migrations/20261119090000_booking_pilgrim_members, docs/rencana-visa-produk.md §3.3): kolom tautan + FK SET NULL,
// isi booking lama dengan aturan lib/booking/members.ts (pemegang visa paket dulu, visa sendiri tidak masuk paket bervisa), booking aktif yang jamaahnya kurang →
// BERHENTI (atomik), riwayat tidak menghentikan; dan DB hasil SEMUA migrasi = schema.prisma (uji drift TERBARU kini di berkas ini).
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

const MIGRATION = '20261119090000_booking_pilgrim_members'
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
const tmp = mkdtempSync(join(tmpdir(), 'members-mig-'))
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
// Migrasi yang diuji DAN semua yang lebih baru — supaya uji drift membandingkan DB hasil SEMUA migrasi.
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
  return { name, ...run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma']) }
}
const diff = (name: string) => run(dbUrl(name), ['migrate', 'diff', '--from-url', dbUrl(name), '--to-schema-datamodel', 'schema.prisma', '--exit-code'])
const one = async (name: string, sql: string) => (await query(name, sql))[0]!
const colExists = async (name: string, table: string, col: string) => Number((await one(name, `select count(*)::int as n from information_schema.columns where table_name = '${table}' and column_name = '${col}'`)).n) === 1
// Fixture SQL (DB pra-migrasi: klien proyek sudah mengenal kolom baru). Id tetap supaya urutan jamaah (= id) bisa diatur.
const U = 'b0000000-0000-4000-8000-0000000000a1'
const V = 'b0000000-0000-4000-8000-0000000000f1'
const id = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const base_ = `
INSERT INTO users (id, email, "passwordHash", "fullName", role, "isActive", "updatedAt") VALUES ('${U}', 'mig@example.test', 'x', 'Uji', 'pilgrim', true, timezone('UTC', now()));
INSERT INTO visa_products (id, name, "visaType", "requiredComponents") VALUES ('${V}', 'Visa Paket', 'Umroh', '[]');
INSERT INTO packages (id, name, "visaMode", "includedVisaProductId") VALUES ('${id(900)}', 'Paket Bervisa', 'included', '${V}');
INSERT INTO packages (id, name) VALUES ('${id(901)}', 'Paket Tanpa Visa');
INSERT INTO haji_products (id, name, "hajiType", year) VALUES ('${id(902)}', 'Haji', 'khusus', 2090);`
const BOOKING = (b: number, status: string) => `INSERT INTO bookings (id, "bookingCode", "userId", season, "totalAmount", status, "updatedAt") VALUES ('${id(b)}', 'K${b}', '${U}', 'regular', 0, '${status}', timezone('UTC', now()));`
const PILGRIM = (b: number, p: number) => `INSERT INTO booking_pilgrims (id, "bookingId") VALUES ('${id(p)}', '${id(b)}');`
const PKG = (b: number, row: number, pkg: number, n: number) => `INSERT INTO booking_packages (id, "bookingId", "packageId", "departureDate", "returnDate", "numPeople", "totalPrice") VALUES ('${id(row)}', '${id(b)}', '${id(pkg)}', '2090-06-01', '2090-06-10', ${n}, 100);`
const HAJI = (b: number, row: number, n: number) => `INSERT INTO booking_haji (id, "bookingId", "hajiProductId", "numPersons", "totalPrice") VALUES ('${id(row)}', '${id(b)}', '${id(902)}', ${n}, 100);`
const APP = (p: number, app: number) => `INSERT INTO visa_applications (id, "bookingPilgrimId", "visaProductId", "visaType") VALUES ('${id(app)}', '${id(p)}', '${V}', 'Umroh');`
/** Visa MILIK jamaah = berbaris harga sendiri. */
const OWN = (b: number, app: number) => `INSERT INTO price_snapshots (id, "bookingId", "itemType", "itemId", "itemLabel", "itemQty", description, qty, unit, "unitSellIdr", "totalSellIdr", mode) VALUES (gen_random_uuid(), '${id(b)}', 'visa', '${id(app)}', 'Visa', 1, 'Visa', 1, 'person', 100, 100, 'auto');`
const links = async (name: string, b: number) => (await query(name, `select id, "bookingPackageId" as pk, "bookingHajiId" as hj from booking_pilgrims where "bookingId" = '${id(b)}' order by id`)).map(r => [r.id, r.pk, r.hj])

console.log('== skenario ==')

await t('ISI booking lama: paket bervisa → pemegang visa paket dulu, lalu jamaah tanpa visa (visa SENDIRI tidak); paket tanpa visa → jamaah tanpa visa dulu; haji urut', async () => {
  const r = await scenario([
    base_, BOOKING(1, 'active'),
    PILGRIM(1, 11), PILGRIM(1, 12), PILGRIM(1, 13), PILGRIM(1, 14),
    APP(13, 113),           // jamaah 13 memegang visa paket (tanpa baris harga)
    APP(11, 111), OWN(1, 111), // jamaah 11 ber-visa SENDIRI
    PKG(1, 21, 900, 2), PKG(1, 22, 901, 1), HAJI(1, 31, 3),
  ].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  assert.deepEqual(await links(r.name, 1), [
    [id(11), null, id(31)],   // ber-visa SENDIRI → tak masuk paket bervisa; paket tanpa visa mendahulukan jamaah tanpa visa sama sekali
    [id(12), id(21), id(31)], // tanpa visa → paket bervisa
    [id(13), id(21), id(31)], // pemegang visa paket → paket bervisa
    [id(14), id(22), null],   // tanpa visa, tersisa → paket tanpa visa
  ])
})

await t('FAIL-CLOSED + ATOMIK: booking AKTIF dengan jamaah kurang dari jumlah orang paket → BERHENTI, tanpa kolom baru', async () => {
  const r = await scenario([base_, BOOKING(2, 'active'), PILGRIM(2, 41), PKG(2, 51, 901, 2)].join('\n'))
  assert.notEqual(r.code, 0, 'harus gagal'); assert.match(r.out, /berjamaah kurang dari jumlah orangnya/)
  assert.equal(await colExists(r.name, 'booking_pilgrims', 'bookingPackageId'), false, 'atomik')
})

await t('booking SELESAI/BATAL yang jamaahnya kurang tidak menghentikan migrasi (riwayat) — diisi sebisanya', async () => {
  const r = await scenario([base_, BOOKING(3, 'cancelled'), PILGRIM(3, 61), PKG(3, 71, 901, 2), HAJI(3, 72, 2)].join('\n'))
  assert.equal(r.code, 0, r.out.slice(-500))
  assert.deepEqual(await links(r.name, 3), [[id(61), id(71), id(72)]])
})

await t('FK: item paket/haji dihapus → tautan jamaah LEPAS (SET NULL), jamaah tetap', async () => {
  const r = await scenario([base_, BOOKING(4, 'active'), PILGRIM(4, 81), PKG(4, 91, 901, 1), HAJI(4, 92, 1)].join('\n'))
  assert.equal(r.code, 0, r.out.slice(-500))
  const db = new PrismaClient({ datasourceUrl: dbUrl(r.name) })
  try {
    await db.$executeRawUnsafe(`DELETE FROM booking_packages WHERE id = '${id(91)}'`)
    await db.$executeRawUnsafe(`DELETE FROM booking_haji WHERE id = '${id(92)}'`)
  } finally { await db.$disconnect() }
  assert.deepEqual(await links(r.name, 4), [[id(81), null, null]])
})

await t('tanpa drift: DB hasil SEMUA migrasi = schema.prisma (uji drift TERBARU berada di berkas ini)', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-500))
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
