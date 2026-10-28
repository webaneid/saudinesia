// Uji migrasi Fase 8A (prisma/migrations/20261031090000_snapshot_recommended_total; docs/arsitektur-harga-terpadu.md §21): kolom rekomendasi baris snapshot (NULL untuk baris lama, tanpa backfill, trigger beku utuh),
// CHECK non-negatif, CHECK 'catatan wajib di bawah HPP' dicabut (consistency tetap), dan DB hasil SEMUA migrasi = schema.prisma (uji drift terbaru berada di berkas ini).
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

const MIGRATION = '20261031090000_snapshot_recommended_total'
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

const diff = (name: string) => run(dbUrl(name), ['migrate', 'diff', '--from-url', dbUrl(name), '--to-schema-datamodel', 'schema.prisma', '--exit-code'])
const q1 = async (name: string, sql: string) => (await query(name, sql))


async function world(db: PrismaClient) {
  const user = await db.user.create({ data: { email: `m${Date.now()}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
  const bk = await db.booking.create({ data: { bookingCode: 'R1', userId: user.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: 1_500_000 } })
  // SQL mentah: klien Prisma proyek sudah mengenal kolom baru yang BELUM ada di DB pra-migrasi.
  await db.$executeRawUnsafe(`INSERT INTO price_snapshots (id, "bookingId", "itemType", "itemId", "lineKey", "itemLabel", "itemQty", description, qty, unit, "unitSellIdr", "totalSellIdr", mode) VALUES ('old1', '${bk.id}', 'hotel', 'old1', 'main', 'Hotel', 1, 'Hotel', 1, 'item', 1500000, 1500000, 'auto')`)
  await db.$executeRawUnsafe(`INSERT INTO booking_adjustments (id, "bookingId", "amountIdr", label, reason, "totalBefore", "totalAfter", "costKnownIdr", "belowCost", "byUserId") VALUES ('adj1', '${bk.id}', -100000, 'Nego', NULL, 1500000, 1400000, 1200000, false, 'x')`)
  return { bk: bk.id }
}

console.log('== skenario ==')

await t('baris snapshot lama utuh: kolom rekomendasi NULL (tanpa backfill), nilai lain tak berubah; penyesuaian lama utuh', async () => {
  const r = await scenarioWith(world)
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const s = await q1(r.name, `select "recommendedTotalIdr" as rec, "totalSellIdr"::float as sell, mode from price_snapshots where id = 'old1'`)
  assert.deepEqual([s[0]!.rec, s[0]!.sell, s[0]!.mode], [null, 1_500_000, 'auto'])
  assert.equal(Number((await q1(r.name, `select count(*)::int as n from booking_adjustments`))[0]!.n), 1)
})
await t('CHECK rekomendasi: negatif ditolak kecuali baris penyesuaian*; NULL dan 0 diizinkan; trigger beku masih menolak UPDATE', async () => {
  const r = await scenarioWith(world)
  assert.equal(r.code, 0, r.out.slice(-300))
  const cons = await q1(r.name, `select conname as n from pg_constraint where conrelid = 'price_snapshots'::regclass and conname = 'price_snapshots_recommended_non_negative'`)
  assert.equal(cons.length, 1)
  const ins = (key: string, rec: string) => `INSERT INTO price_snapshots (id, "bookingId", "itemType", "itemId", "lineKey", "itemLabel", "itemQty", description, qty, unit, "unitSellIdr", "totalSellIdr", "recommendedTotalIdr", mode) SELECT 'n-${key}', "bookingId", 'x', 'n-${key}', '${key}', 'L', 1, 'D', 1, 'item', 10, 10, ${rec}, 'auto' FROM price_snapshots WHERE id = 'old1'`
  assert.notEqual(exec(r.name, ins('main', '-1')).code, 0, 'negatif pada baris biasa harus ditolak')
  assert.equal(exec(r.name, ins('penyesuaian', '-5')).code, 0)
  assert.equal(exec(r.name, ins('komponen:z', '0')).code, 0)
  assert.equal(exec(r.name, ins('komponen:y', 'NULL')).code, 0)
  const upd = exec(r.name, `UPDATE price_snapshots SET "recommendedTotalIdr" = 1 WHERE id = 'old1'`)
  assert.notEqual(upd.code, 0, 'UPDATE snapshot tetap ditolak trigger beku')
})
await t('CHECK "catatan wajib di bawah HPP" dicabut (di bawah HPP tanpa catatan diterima), tetapi konsistensi belowCost = (total akhir < HPP) tetap menolak', async () => {
  const r = await scenarioWith(world)
  assert.equal(r.code, 0, r.out.slice(-300))
  const names = (await q1(r.name, `select conname as n from pg_constraint where conrelid = 'booking_adjustments'::regclass and contype = 'c' order by 1`)).map(x => x.n)
  assert.ok(!names.includes('booking_adjustments_below_cost_needs_reason'))
  assert.ok(names.includes('booking_adjustments_below_cost_consistent'))
  const ins = (below: string, after: string) => `INSERT INTO booking_adjustments (id, "bookingId", "amountIdr", label, reason, "totalBefore", "totalAfter", "costKnownIdr", "belowCost", "byUserId") SELECT 'x-${below}', "bookingId", ${after} - 1500000, 'L', NULL, 1500000, ${after}, 1200000, ${below}, 'x' FROM price_snapshots WHERE id = 'old1'`
  assert.equal(exec(r.name, ins('true', '1100000')).code, 0, 'di bawah HPP tanpa catatan diterima DB')
  assert.notEqual(exec(r.name, ins('false', '1100000')).code, 0, 'belowCost tak konsisten tetap ditolak')
})
await t('tabel kosong aman; tanpa drift: DB hasil SEMUA migrasi = schema.prisma', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0, r.out.slice(-300))
  const d = diff(r.name)
  assert.equal(d.code, 0, `drift skema:\n${d.out.slice(-800)}`)
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
