// Uji migrasi invoice (prisma/migrations/20261108090000_invoices, docs/arsitektur-booking-engine-v2.md §10.4 Fase 6a): booking terbit lama diberi TEPAT SATU invoice bernomor
// (pola/awalan/lebar dari invoice_settings, tahun & tanggal di zona aplikasi, urut tanggal dibuat, tanpa lompat), penghitung diselaraskan, draf tanpa invoice, pajak 0,
// kop/rekening beku; fail-closed tanpa setelan; CHECK. Uji drift TERBARU pindah ke scripts/test-booking-revisions-migration.ts.
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

const MIGRATION = '20261108090000_invoices'
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
const tmp = mkdtempSync(join(tmpdir(), 'invoices-mig-'))
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

const BK = (code: string, status: string, createdUtc: string, deadlineUtc: string | null) =>
  `INSERT INTO bookings (id, "bookingCode", "userId", status, season, "totalAmount", "createdAt", "paymentDeadline", "updatedAt") VALUES (gen_random_uuid(), '${code}', 'd0000000-0000-4000-8000-000000000001', '${status}'::booking_status, 'regular', 1000, '${createdUtc}', ${deadlineUtc ? `'${deadlineUtc}'` : 'NULL'}, now());`
const SETTINGS = (pattern: string, padding: number, yearly: boolean) =>
  `UPDATE invoice_settings SET "numberPrefix" = 'SND', "numberPattern" = '${pattern}', "numberPadding" = ${padding}, "numberResetYearly" = ${yearly}, "appTimezone" = 'Asia/Jakarta', "companyName" = 'PT Uji', "companyTaxId" = '01.234', "termsDoc" = 'S&K' WHERE id = 'global';
   INSERT INTO bank_accounts (id, "bankName", "accountNumber", "accountHolder", "isActive", "sortOrder", "updatedAt") VALUES (gen_random_uuid(), 'BSI', '111', 'PT Uji', true, 1, now()), (gen_random_uuid(), 'BCA', '222', 'PT Uji', false, 0, now());`
const inv = (name: string) => query(name, `select b."bookingCode" as code, i.number, i."sequenceKey" as k, i.sequence as seq, to_char(i."invoiceDate", 'YYYY-MM-DD') as d, to_char(i."dueDate", 'YYYY-MM-DD') as due,
  i."taxAddedIdr"::float as tax, i."taxLines" as lines, i.revision as rev, i."companySnapshot"->>'name' as co, i."bankSnapshot" as banks, i."termsDoc" as terms
  from invoices i join bookings b on b.id = i."bookingId" order by i."sequenceKey", i.sequence`)

await t('BACKFILL reset tahunan: satu invoice per booking terbit (draf tidak), urut tanggal dibuat per TAHUN ZONA APLIKASI (31 Des 18.00 UTC = 1 Jan WIB), jatuh tempo = tanggal batas bayar WIB, pajak 0, kop + rekening AKTIF beku; penghitung = nomor terakhir, penghitung hantu → 0', async () => {
  const r = await scenario([USER, SETTINGS('{PREFIX}-{YYYY}-{SEQ}', 4, true),
    BK('C1', 'active', '2026-03-01 02:00', '2026-03-05 16:59:59.999'),
    BK('C2', 'cancelled', '2026-05-01 02:00', null),
    BK('C3', 'active', '2026-12-31 18:00', '2027-01-04 16:59:59.999'),
    BK('C4', 'draft', '2026-04-01 02:00', null),
    `INSERT INTO invoice_sequences (key, "lastNumber", "updatedAt") VALUES ('2026', 9, now()), ('2025', 6, now()), ('all', 4, now());`].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  const rows = await inv(r.name)
  assert.deepEqual(rows.map(x => [x.code, x.number, x.k, x.seq, x.d, x.due]), [
    ['C1', 'SND-2026-0001', '2026', 1, '2026-03-01', '2026-03-05'],
    ['C2', 'SND-2026-0002', '2026', 2, '2026-05-01', '2026-05-01'],
    ['C3', 'SND-2027-0001', '2027', 1, '2027-01-01', '2027-01-04'],
  ])
  for (const x of rows) {
    assert.deepEqual([x.tax, x.lines, x.rev, x.co, x.terms], [0, [], 1, 'PT Uji', 'S&K'])
    assert.deepEqual(x.banks, [{ bankName: 'BSI', accountNumber: '111', accountHolder: 'PT Uji', branch: null }])
  }
  // Penghitung tanpa invoice (sisa uji/alokasi hantu sebelum tabel ini ada) → 0: invoice pertama tahun itu bernomor 1, tanpa lompatan.
  assert.deepEqual(await query(r.name, `select key, "lastNumber" as n from invoice_sequences order by key`), [{ key: '2025', n: 0 }, { key: '2026', n: 2 }, { key: '2027', n: 1 }, { key: 'all', n: 0 }])
})

await t('BACKFILL tanpa reset tahunan: kunci "all", {SEQ} melebihi lebar tetap utuh (tak dipotong), {YY}/{MM} dari tanggal dibuat', async () => {
  const fixtures = [USER, SETTINGS('{PREFIX}{YY}{MM}-{SEQ}', 1, false)]
  for (let i = 1; i <= 11; i++) fixtures.push(BK(`D${String(i).padStart(2, '0')}`, 'completed', `2026-07-${String(i).padStart(2, '0')} 03:00`, null))
  const r = await scenario(fixtures.join('\n'))
  assert.equal(r.code, 0, r.out.slice(-600))
  const rows = await inv(r.name)
  assert.equal(rows.length, 11)
  assert.deepEqual([rows[0]!.number, rows[8]!.number, rows[10]!.number, rows[10]!.k], ['SND2607-1', 'SND2607-9', 'SND2607-11', 'all'])
  assert.deepEqual(await query(r.name, `select key, "lastNumber" as n from invoice_sequences order by key`), [{ key: 'all', n: 11 }])
})

await t('FAIL-CLOSED + ATOMIK: tanpa baris invoice_settings global → migrasi gagal dan tabel invoices TIDAK ada', async () => {
  const r = await scenario([USER, BK('E1', 'active', '2026-03-01 02:00', null), `DELETE FROM invoice_settings WHERE id = 'global';`].join('\n'))
  assert.notEqual(r.code, 0, 'migrasi harus gagal')
  assert.match(r.out, /invoice_settings global tidak ada|invoices/)
  assert.deepEqual(await query(r.name, `select count(*)::int as n from information_schema.tables where table_name = 'invoices'`), [{ n: 0 }])
})

await t('CHECK + UNIK: jatuh tempo < tanggal invoice, revisi 0, pajak negatif, bentuk JSON salah, nomor/booking kembar → ditolak', async () => {
  const r = await scenario([USER, SETTINGS('{PREFIX}-{YYYY}-{SEQ}', 4, true), BK('F1', 'active', '2026-03-01 02:00', null), BK('F2', 'active', '2026-03-02 02:00', null)].join('\n'))
  assert.equal(r.code, 0, r.out.slice(-300))
  const db = new PrismaClient({ datasourceUrl: dbUrl(r.name) })
  try {
    const bad = [
      `UPDATE invoices SET "dueDate" = "invoiceDate" - 1`,
      `UPDATE invoices SET revision = 0`,
      `UPDATE invoices SET "taxAddedIdr" = -1`,
      `UPDATE invoices SET "taxLines" = '{}'`,
      `UPDATE invoices SET "companySnapshot" = '[]'`,
      `UPDATE invoices SET number = 'SAMA'`,
      `UPDATE invoices SET "bookingId" = (SELECT id FROM bookings WHERE "bookingCode" = 'F1')`,
    ]
    for (const sql of bad) await assert.rejects(() => db.$executeRawUnsafe(sql), /check|unique|duplicate|violates|23505|23514|already exists/i, sql)
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
