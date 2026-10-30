// Uji migrasi SEC-101 (prisma/migrations/20261101090000_adjustment_reason_edit_trail; docs/lessons-learned.md): jejak siapa+kapan edit catatan penyesuaian — baris lama NULL (tanpa backfill),
// CHECK pasangan (keduanya ada atau kosong), (uji drift terbaru kini di test-drop-group-booking-visa-migration).
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

const MIGRATION = '20261101090000_adjustment_reason_edit_trail'
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


async function world(db: PrismaClient) {
  const user = await db.user.create({ data: { email: `m${Date.now()}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
  const bk = await db.booking.create({ data: { bookingCode: 'R1', userId: user.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: 1_500_000 }, select: { id: true } })
  // SQL mentah: klien Prisma proyek sudah mengenal kolom baru yang BELUM ada di DB pra-migrasi.
  await db.$executeRawUnsafe(`INSERT INTO price_snapshots (id, "bookingId", "itemType", "itemId", "lineKey", "itemLabel", "itemQty", description, qty, unit, "unitSellIdr", "totalSellIdr", mode) VALUES ('old1', '${bk.id}', 'hotel', 'old1', 'main', 'Hotel', 1, 'Hotel', 1, 'item', 1500000, 1500000, 'auto')`)
  await db.$executeRawUnsafe(`INSERT INTO booking_adjustments (id, "bookingId", "amountIdr", label, reason, "totalBefore", "totalAfter", "costKnownIdr", "belowCost", "byUserId") VALUES ('adj1', '${bk.id}', -100000, 'Nego', NULL, 1500000, 1400000, 1200000, false, 'x')`)
  return { bk: bk.id }
}

console.log('== skenario ==')

await t('penyesuaian lama utuh: kolom jejak NULL/NULL (tanpa backfill), nilai lain tak berubah', async () => {
  const r = await scenarioWith(world)
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const a = await q1(r.name, `select "reasonEditedByUserId" as by, "reasonEditedAt" as at, label, reason, "amountIdr"::float as amt, "belowCost" as below from booking_adjustments where id = 'adj1'`)
  assert.deepEqual([a[0]!.by, a[0]!.at, a[0]!.label, a[0]!.reason, a[0]!.amt, a[0]!.below], [null, null, 'Nego', null, -100_000, false])
})
await t('CHECK pasangan: pelaku tanpa waktu atau waktu tanpa pelaku ditolak; keduanya ada atau keduanya kosong diterima; menghapus satu sisi ditolak', async () => {
  const r = await scenarioWith(world)
  assert.equal(r.code, 0, r.out.slice(-300))
  assert.equal((await q1(r.name, `select conname as n from pg_constraint where conrelid = 'booking_adjustments'::regclass and conname = 'booking_adjustments_reason_edit_paired'`)).length, 1)
  const upd = (set: string) => exec(r.name, `UPDATE booking_adjustments SET ${set} WHERE id = 'adj1'`)
  assert.notEqual(upd(`"reasonEditedByUserId" = 'staf-1'`).code, 0, 'pelaku tanpa waktu')
  assert.notEqual(upd(`"reasonEditedAt" = now()`).code, 0, 'waktu tanpa pelaku')
  assert.equal(upd(`"reasonEditedByUserId" = 'staf-1', "reasonEditedAt" = now()`).code, 0, 'keduanya ada')
  assert.notEqual(upd(`"reasonEditedAt" = NULL`).code, 0, 'menghapus satu sisi')
  assert.equal(upd(`"reasonEditedByUserId" = NULL, "reasonEditedAt" = NULL`).code, 0, 'keduanya kosong')
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
