// Uji migrasi Pengaturan Invoice (prisma/migrations/20261104090000_invoice_settings): ADITIF — tabel baru + baris bawaan, tak ada data lama tersentuh; CHECK terpasang; dan DB hasil
// SEMUA migrasi = schema.prisma (uji drift TERBARU kini di scripts/test-booking-lifecycle-migration.ts).
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

const MIGRATION = '20261104090000_invoice_settings'
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
  return db.user.create({ data: { email: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
}
const exists = async (name: string, rel: string) => Number((await q1(name, `select count(*)::int as n from information_schema.tables where table_name = '${rel}'`))[0]!.n) === 1
const colExists = async (name: string) => Number((await q1(name, `select count(*)::int as n from information_schema.columns where table_name = 'bookings' and column_name = 'groupId'`))[0]!.n) === 1

console.log('== skenario ==')

async function seedBooking(db: PrismaClient, code: string) {
  const u = await db.user.create({ data: { email: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
  await db.booking.create({ data: { bookingCode: code, userId: u.id, departureDate: new Date('2027-06-01'), returnDate: new Date('2027-06-10'), season: 'regular', totalAmount: 1 }, select: { id: true } })
  return u.id
}

await t('DB pra-migrasi berisi data → migrasi berhasil, data lama utuh, 5 tabel baru ada, baris global + PPN 0% tersemai, nilai bawaan benar', async () => {
  const r = await scenarioWith(async db => { await seedBooking(db, 'K1'); return {} })
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  assert.equal(Number((await query(r.name, `select count(*)::int as n from bookings`))[0]!.n), 1, 'booking lama utuh')
  assert.equal(Number((await query(r.name, `select count(*)::int as n from users`))[0]!.n), 1, 'pengguna lama utuh')
  for (const rel of ['invoice_settings', 'bank_accounts', 'qris_accounts', 'tax_rules', 'invoice_sequences']) assert.equal(Number((await query(r.name, `select count(*)::int as n from information_schema.tables where table_name = '${rel}'`))[0]!.n), 1, rel)
  const s = (await query(r.name, `select id, "numberPrefix", "numberPattern", "numberPadding", "numberResetYearly", "appTimezone", "defaultDueDays", "expireDaysBeforeReference", "minimumFirstPaymentPercent"::float as minpay, "uniqueCodeMin", "uniqueCodeMax", "methodBankTransfer", "methodQris", "gatewaySandbox", pg_typeof("updatedAt")::text as updated_type from invoice_settings`))
  assert.equal(s.length, 1)
  assert.deepEqual(s[0], { id: 'global', numberPrefix: 'INV', numberPattern: '{PREFIX}-{YYYY}-{SEQ}', numberPadding: 4, numberResetYearly: true, appTimezone: 'Asia/Jakarta', defaultDueDays: 4, expireDaysBeforeReference: 7, minpay: 0, uniqueCodeMin: 100, uniqueCodeMax: 999, methodBankTransfer: true, methodQris: false, gatewaySandbox: true, updated_type: 'timestamp with time zone' })
  const tax = await query(r.name, `select name, "ratePercent"::float as rate, mode::text as mode, "isActive" from tax_rules`)
  assert.deepEqual(tax, [{ name: 'PPN', rate: 0, mode: 'added', isActive: true }])
})

await t('CHECK terpasang di DB hasil migrasi (15 + 4 penguatan), jejak settings_audit append-only (trigger), dan kolom waktu baru bertipe timestamptz', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0)
  const names = (await query(r.name, `select conname from pg_constraint where contype = 'c' and conrelid::regclass::text in ('invoice_settings','tax_rules','bank_accounts','qris_accounts','invoice_sequences') order by conname`)).map(x => x.conname)
  assert.deepEqual(names, ['bank_accounts_fields', 'invoice_sequences_last', 'invoice_settings_due_days', 'invoice_settings_expire_days', 'invoice_settings_fees', 'invoice_settings_min_payment', 'invoice_settings_number_padding', 'invoice_settings_number_pattern', 'invoice_settings_number_pattern_charset', 'invoice_settings_number_prefix', 'invoice_settings_singleton', 'invoice_settings_timezone_shape', 'invoice_settings_unique_code', 'invoice_settings_website', 'qris_accounts_name', 'qris_accounts_payload', 'tax_rules_basis', 'tax_rules_name', 'tax_rules_rate'])
  const trig = await query(r.name, `select tgname from pg_trigger where tgrelid = 'settings_audit'::regclass and not tgisinternal`)
  assert.deepEqual(trig, [{ tgname: 'settings_audit_no_change' }])
  const types = await query(r.name, `select table_name, column_name, data_type from information_schema.columns where table_name in ('bank_accounts','qris_accounts','tax_rules','invoice_sequences','invoice_settings') and column_name in ('createdAt','updatedAt') order by 1,2`)
  assert.ok(types.length === 8 && types.every(x => x.data_type === 'timestamp with time zone'), JSON.stringify(types))
})

// (uji drift TERBARU kini di scripts/test-booking-lifecycle-migration.ts)

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
