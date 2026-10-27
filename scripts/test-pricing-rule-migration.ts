// Uji migrasi kunci aturan margin global (prisma/migrations/20261028090000_pricing_rule_global_key; docs/arsitektur-harga-terpadu.md §1.2-7, Fase 0).
// Membangun database "pra-migrasi" (semua migrasi KECUALI yang diuji) lalu menyalinnya per skenario (CREATE DATABASE … TEMPLATE), mengisi data lama
// (baris global NULL ganda hasil permintaan paralel) dan menjalankan migrasi lewat `prisma migrate deploy` sungguhan.
// Dibuktikan: tepat satu baris global tersisa (yang terbaru), kunci 'global' non-NULL + unik, baris per-tipe utuh, fail-closed + ATOMIK, tanpa drift skema.
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

const MIGRATION = '20261028090000_pricing_rule_global_key'
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
const rule = (i: number, type: string | null, margin: number, at: string) =>
  `INSERT INTO pricing_rules (id, "productType", "minMarginPercent", "roundingIncrement", "updatedAt") VALUES ('${id(i)}', ${type === null ? 'NULL' : `'${type}'`}, ${margin}, 50000, '${at}');`
const rules = (name: string) => query(name, `select id, "productType" as t, "minMarginPercent"::float as m from pricing_rules order by "productType", id`)
const diff = (name: string) => run(dbUrl(name), ['migrate', 'diff', '--from-url', dbUrl(name), '--to-schema-datamodel', 'schema.prisma', '--exit-code'])

console.log('== skenario ==')

await t('baris global NULL ganda → tepat SATU tersisa (yang terbaru), jadi kunci \'global\'; baris per-tipe utuh', async () => {
  const r = await scenario([rule(1, null, 20, '2026-07-18 07:03:10'), rule(2, null, 25, '2026-09-01 10:00:00'), rule(3, 'visa', 30, '2026-07-20 00:00:00')].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const rows = await rules(r.name)
  assert.deepEqual(rows.map(x => [x.id, x.t, x.m]), [[id(2), 'global', 25], [id(3), 'visa', 30]], 'baris terbaru bertahan; per-tipe tak tersentuh')
})

await t('seri updatedAt → baris dengan id terbesar bertahan (deterministik)', async () => {
  const r = await scenario([rule(1, null, 20, '2026-07-18 07:03:10.789'), rule(2, null, 21, '2026-07-18 07:03:10.789')].join('\n'))
  assert.equal(r.code, 0, r.out.slice(-400))
  assert.deepEqual((await rules(r.name)).map(x => [x.id, x.t]), [[id(2), 'global']])
})

await t('tabel kosong dan satu baris global: berhasil; kunci non-NULL, default \'global\', dan baris global KEDUA ditolak DB', async () => {
  const r = await scenario(rule(1, null, 20, '2026-07-18 07:03:10'))
  assert.equal(r.code, 0, r.out.slice(-400))
  const col = await query(r.name, `select is_nullable as n, column_default as d from information_schema.columns where table_name = 'pricing_rules' and column_name = 'productType'`)
  assert.equal(col[0]!.n, 'NO'); assert.match(String(col[0]!.d), /global/)
  const ins = (sql: string) => exec(r.name, sql)
  assert.notEqual(ins(`INSERT INTO pricing_rules (id, "productType", "minMarginPercent", "roundingIncrement", "updatedAt") VALUES ('${id(9)}', NULL, 1, 1, now());`).code, 0, 'NULL harus ditolak')
  assert.notEqual(ins(`INSERT INTO pricing_rules (id, "productType", "minMarginPercent", "roundingIncrement", "updatedAt") VALUES ('${id(8)}', 'global', 1, 1, now());`).code, 0, 'global kedua harus ditolak oleh indeks unik')
  assert.equal(Number((await query(r.name, `select count(*)::int as n from pricing_rules`))[0]!.n), 1)
  const empty = await scenario('')
  assert.equal(empty.code, 0, empty.out.slice(-300)); assert.equal((await rules(empty.name)).length, 0)
})

await t('FAIL-CLOSED + ATOMIK: baris \'global\' sudah ada di samping baris NULL → migrasi gagal, kolom TETAP nullable, tak ada yang berubah', async () => {
  const r = await scenario([rule(1, null, 20, '2026-07-18 07:03:10'), rule(2, 'global', 40, '2026-07-19 00:00:00')].join('\n'))
  assert.notEqual(r.code, 0, 'tabrakan kunci harus membatalkan migrasi')
  const col = await query(r.name, `select is_nullable as n from information_schema.columns where table_name = 'pricing_rules' and column_name = 'productType'`)
  assert.equal(col[0]!.n, 'YES', 'transaksi dibatalkan: kolom tidak boleh sempat NOT NULL')
  assert.equal((await rules(r.name)).length, 2, 'tak ada baris yang terhapus/berubah setelah kegagalan')
})

await t('tanpa drift: DB hasil SEMUA migrasi = schema.prisma', async () => {
  const r = await scenario([rule(1, null, 20, '2026-07-18 07:03:10'), rule(2, null, 25, '2026-09-01 10:00:00')].join('\n'))
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
