// Uji migrasi Fase 7 (prisma/migrations/20261030090000_adjustments_cost_actuals; docs/arsitektur-harga-terpadu.md §20): perbaikan data jumlah pembayaran (terkonfirmasi bernilai 0 → total booking;
// pending/ditolak/yang sudah berjumlah tak disentuh), tabel penyesuaian + pengeluaran aktual, (uji drift terbaru kini di test-snapshot-recommended-migration).
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

const MIGRATION = '20261030090000_adjustments_cost_actuals'
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
  const user = await legacyUser(db, { email: `m${Date.now()}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() })
  const mk = (code: string, total: number) => db.booking.create({ data: { bookingCode: code, userId: user.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: total }, select: { id: true } })
  const b1 = await mk('M1', 5_000_000), b2 = await mk('M2', 3_000_000)
  const pay = (bookingId: string, status: 'pending' | 'confirmed' | 'rejected', amount: number) => db.payment.create({ data: { bookingId, amount, method: 'bank_transfer', status } })
  const confirmedZero = await pay(b1.id, 'confirmed', 0)       // alur lama: dikonfirmasi tanpa jumlah → total booking
  const pendingZero = await pay(b1.id, 'pending', 0)           // belum diverifikasi → tetap 0
  const rejectedZero = await pay(b2.id, 'rejected', 0)         // ditolak → tetap 0
  const confirmedSet = await pay(b2.id, 'confirmed', 1_200_000) // sudah berjumlah → tak disentuh
  return { b1: b1.id, confirmedZero: confirmedZero.id, pendingZero: pendingZero.id, rejectedZero: rejectedZero.id, confirmedSet: confirmedSet.id }
}
const amounts = (name: string) => q1(name, `select id, amount::float as a from payments`)

console.log('== skenario ==')

await t('pembayaran terkonfirmasi bernilai 0 → total booking; pending/ditolak bernilai 0 dan yang sudah berjumlah TIDAK berubah', async () => {
  const r = await scenarioWith(world)
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const by = Object.fromEntries((await amounts(r.name)).map(x => [x.id as string, x.a as number]))
  assert.deepEqual([by[r.ids.confirmedZero!], by[r.ids.pendingZero!], by[r.ids.rejectedZero!], by[r.ids.confirmedSet!]], [5_000_000, 0, 0, 1_200_000])
})
await t('tabel baru ada dengan aturan DB: penyesuaian (jumlah ≠ 0, total akhir > 0, total konsisten, catatan wajib bila di bawah HPP, pembalik unik) dan pengeluaran (jumlah > 0, mata uang huruf besar, IDR sama, void konsisten); FK pesanan cascade, vendor restrict', async () => {
  const r = await scenarioWith(world)
  assert.equal(r.code, 0, r.out.slice(-300))
  const cons = await q1(r.name, `select conname as n from pg_constraint where conrelid in ('booking_adjustments'::regclass, 'cost_actuals'::regclass) and contype = 'c' order by 1`)
  assert.deepEqual(cons.map(x => x.n), [
    'booking_adjustments_amount_nonzero', 'booking_adjustments_below_cost_consistent', 'booking_adjustments_below_cost_needs_reason', 'booking_adjustments_label_present', 'booking_adjustments_total_after_positive', 'booking_adjustments_total_consistent',
    'cost_actuals_amounts_positive', 'cost_actuals_component_present', 'cost_actuals_currency_upper', 'cost_actuals_idr_equal', 'cost_actuals_void_consistent',
  ])
  const fks = await q1(r.name, `select conname as n, confdeltype as d from pg_constraint where contype = 'f' and conrelid in ('booking_adjustments'::regclass, 'cost_actuals'::regclass) order by 1`)
  assert.deepEqual(fks.map(x => [x.n, x.d]), [['booking_adjustments_bookingId_fkey', 'c'], ['booking_adjustments_reversesId_fkey', 'r'], ['cost_actuals_bookingId_fkey', 'c'], ['cost_actuals_snapshotId_fkey', 'n'], ['cost_actuals_vendorId_fkey', 'r']])
  assert.equal(Number((await q1(r.name, `select count(*)::int as n from pg_indexes where indexname = 'booking_adjustments_reversesId_key'`))[0]!.n), 1)
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
