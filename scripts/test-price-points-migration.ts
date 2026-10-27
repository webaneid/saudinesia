// Uji migrasi tabel titik harga (prisma/migrations/20261028120000_price_points; docs/arsitektur-harga-terpadu.md §3/§14, Fase 1).
// Membangun database "pra-migrasi" (semua migrasi KECUALI yang diuji), menyalinnya per skenario (CREATE DATABASE … TEMPLATE) dan menjalankan migrasi
// lewat `prisma migrate deploy` sungguhan. Dibuktikan: ekspansi murni (data lama tak tersentuh), CHECK invarian I2 dijaga DB (jual = manual ?? otomatis,
// salah satunya wajib, tak ada nominal negatif), keunikan (pemilik, varian), dan tanpa drift skema (uji drift terbaru berada di berkas ini).
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

const MIGRATION = '20261028120000_price_points'
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
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const diff = (name: string) => run(dbUrl(name), ['migrate', 'diff', '--from-url', dbUrl(name), '--to-schema-datamodel', 'schema.prisma', '--exit-code'])

const point = (i: number, cols: string, vals: string, variant = '') =>
  `INSERT INTO price_points (id, "ownerType", "ownerId", "variantKey", unit, ${cols}, "updatedAt") VALUES ('${id(i)}', 'hotel', '${id(100 + i)}', '${variant}', 'room_night', ${vals}, now());`

console.log('== skenario ==')

await t('ekspansi murni: tabel + indeks ada, kosong, dan data lama (aturan margin) tak tersentuh', async () => {
  const r = await scenario(`INSERT INTO pricing_rules (id, "productType", "minMarginPercent", "roundingIncrement", "updatedAt") VALUES ('${id(1)}', 'global', 25, 50000, now());`)
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  assert.equal(Number((await query(r.name, `select count(*)::int as n from price_points`))[0]!.n), 0)
  assert.equal(Number((await query(r.name, `select "minMarginPercent"::float as m from pricing_rules`))[0]!.m), 25)
  const idx = await query(r.name, `select indexname from pg_indexes where tablename = 'price_points' order by 1`)
  assert.ok(idx.some(x => String(x.indexname).includes('ownerType_ownerId_variantKey_key')), 'indeks unik pemilik+varian harus ada')
})

await t('CHECK I2: jual = manual ?? otomatis — hanya kombinasi yang konsisten diterima DB', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-300))
  const ins = (sql: string) => exec(r.name, sql).code
  const cols = '"autoSellIdr", "manualSellIdr", "sellIdr"'
  assert.equal(ins(point(1, cols, '100000, NULL, 100000')), 0, 'otomatis saja')
  assert.equal(ins(point(2, cols, 'NULL, 90000, 90000')), 0, 'manual saja')
  assert.equal(ins(point(3, cols, '100000, 90000, 90000')), 0, 'manual menang atas otomatis')
  assert.notEqual(ins(point(4, cols, '100000, 90000, 100000')), 0, 'jual = otomatis padahal ada manual → ditolak')
  assert.notEqual(ins(point(5, cols, '100000, NULL, 90000')), 0, 'jual ≠ otomatis → ditolak')
  assert.notEqual(ins(point(6, cols, 'NULL, NULL, 0')), 0, 'tanpa manual maupun otomatis → ditolak')
  assert.notEqual(ins(point(7, cols, 'NULL, NULL, 100000')), 0, 'jual tanpa sumber → ditolak')
})

await t('CHECK: nominal negatif ditolak; modal boleh kosong (modal belum diisi) dan nol; jual 0 sah (komposit kosong)', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-300))
  const ins = (sql: string) => exec(r.name, sql).code
  assert.notEqual(ins(point(1, '"costIdr", "autoSellIdr", "sellIdr"', '-1, 100, 100')), 0, 'modal negatif')
  assert.notEqual(ins(point(2, '"autoSellIdr", "sellIdr"', '-5, -5')), 0, 'jual negatif')
  assert.notEqual(ins(point(3, '"autoSellIdr", "manualSellIdr", "sellIdr"', '100, -1, -1')), 0, 'manual negatif')
  assert.equal(ins(point(4, '"costIdr", "autoSellIdr", "sellIdr"', 'NULL, 100, 100')), 0, 'modal kosong')
  assert.equal(ins(point(5, '"costIdr", "autoSellIdr", "sellIdr"', '0, 0, 0')), 0, 'komposit kosong: modal 0, jual 0')
})

await t('keunikan (pemilik, varian): duplikat ditolak, varian berbeda dan pemilik berbeda diterima', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-300))
  const cols = '"autoSellIdr", "sellIdr"'
  const row = (i: number, owner: string, variant: string) =>
    `INSERT INTO price_points (id, "ownerType", "ownerId", "variantKey", unit, ${cols}, "updatedAt") VALUES ('${id(i)}', 'visa', '${owner}', '${variant}', 'person', 1, 1, now());`
  assert.equal(exec(r.name, row(1, id(500), 'days:0-9')).code, 0)
  assert.notEqual(exec(r.name, row(2, id(500), 'days:0-9')).code, 0, 'pemilik+varian sama')
  assert.equal(exec(r.name, row(3, id(500), 'days:10-20')).code, 0, 'varian lain')
  assert.equal(exec(r.name, row(4, id(501), 'days:0-9')).code, 0, 'pemilik lain')
})

await t('tanpa drift: DB hasil SEMUA migrasi = schema.prisma', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-300))
  const d = diff(r.name)
  assert.equal(d.code, 0, `drift skema:\n${d.out.slice(-600)}`)
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
