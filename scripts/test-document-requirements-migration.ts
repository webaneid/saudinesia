// Uji migrasi prisma/migrations/20261114090000_document_requirements_catalog (docs/arsitektur-jamaah.md §7.6): syarat dokumen dipetakan dari kunci teks lama ke
// katalog `document_types`, `visa_products.requirements` dibuang — FAIL-CLOSED bila Json tak tercermin di baris, kunci tak dikenal, atau ganda sesudah pemetaan.
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

const MIGRATION = '20261114090000_document_requirements_catalog'
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
const tmp = mkdtempSync(join(tmpdir(), 'docreq-mig-'))
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
const visa = (id: string, reqs: string[]) =>
  `INSERT INTO visa_products (id, name, "visaType", requirements) VALUES ('${id}', 'Visa ${id}', 'Umroh', '${JSON.stringify(reqs.map(d => ({ docType: d, label: d, description: '', required: true })))}'::jsonb);`
const req = (id: string, product: string, docType: string, label: string, order = 0) =>
  `INSERT INTO document_requirements (id, "productType", "productId", "docType", label, description, required, "order") VALUES ('${id}', 'visa', '${product}', '${docType}', '${label}', '', true, ${order});`
const typeKey = `(select key from document_types t where t.id = r."documentTypeId")`

console.log('== skenario ==')

await t('KEADAAN DEV: Json = baris (passport, ktp, kartu_keluarga) → dipetakan ke passport/ktp/kk, label pengganti dipertahankan, kolom Json hilang', async () => {
  const r = await scenario(visa('v1', ['passport', 'ktp', 'kartu_keluarga']) + req('r1', 'v1', 'passport', 'Passport Aktif', 0) + req('r2', 'v1', 'ktp', 'Scan KTP Asli', 1) + req('r3', 'v1', 'kartu_keluarga', 'Scan Kartu Keluarga', 2))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  const rows = await query(r.name, `select ${typeKey} as k, r.label from document_requirements r order by r."order"`)
  assert.deepEqual(rows.map(x => [x.k, x.label]), [['passport', 'Passport Aktif'], ['ktp', 'Scan KTP Asli'], ['kk', 'Scan Kartu Keluarga']])
  assert.equal((await query(r.name, `select 1 from information_schema.columns where table_name = 'visa_products' and column_name = 'requirements'`)).length, 0)
  assert.equal((await query(r.name, `select 1 from information_schema.columns where table_name = 'document_requirements' and column_name = 'docType'`)).length, 0)
})
await t('ALIAS lama: evaksin → vaccine, etiket → flight_ticket, paspor → passport', async () => {
  const r = await scenario(visa('v2', ['evaksin', 'etiket', 'paspor']) + req('a', 'v2', 'evaksin', 'Vaksin', 0) + req('b', 'v2', 'etiket', 'Tiket', 1) + req('c', 'v2', 'paspor', 'Paspor', 2))
  assert.equal(r.code, 0, r.out.slice(-600))
  assert.deepEqual((await query(r.name, `select ${typeKey} as k from document_requirements r order by r."order"`)).map(x => x.k), ['vaccine', 'flight_ticket', 'passport'])
})
await t('FAIL-CLOSED: Json memuat syarat tanpa baris document_requirements → BERHENTI, kolom Json tetap ada', async () => {
  const r = await scenario(visa('v3', ['passport', 'ktp']) + req('d', 'v3', 'passport', 'Paspor'))
  assert.notEqual(r.code, 0, 'migrasi harus gagal')
  assert.match(r.out, /tanpa baris document_requirements/)
  assert.equal((await query(r.name, `select 1 from information_schema.columns where table_name = 'visa_products' and column_name = 'requirements'`)).length, 1)
})
await t('FAIL-CLOSED: kunci tak dikenal katalog (iqomah) → BERHENTI dengan nama kuncinya', async () => {
  const r = await scenario(visa('v4', []) + req('e', 'v4', 'iqomah', 'Iqomah'))
  assert.notEqual(r.code, 0)
  assert.match(r.out, /tak dikenal katalog[^\n]*iqomah/, r.out.slice(-700))
})
await t('FAIL-CLOSED: dua kunci lama menjadi satu jenis (kk + kartu_keluarga) → BERHENTI', async () => {
  const r = await scenario(visa('v5', []) + req('f', 'v5', 'kk', 'KK') + req('g', 'v5', 'kartu_keluarga', 'Kartu Keluarga', 1))
  assert.notEqual(r.code, 0)
  assert.match(r.out, /ganda/)
})
await t('CHECK + FK sesudah migrasi: label < 2 karakter ditolak; jenis yang dirujuk syarat tak bisa dihapus (Restrict)', async () => {
  const r = await scenario(visa('v6', ['ktp']) + req('h', 'v6', 'ktp', 'KTP'))
  assert.equal(r.code, 0, r.out.slice(-600))
  const bad = exec(r.name, `UPDATE document_requirements SET label = 'x';`)
  assert.notEqual(bad.code, 0, 'label 1 karakter harus ditolak CHECK')
  const del = exec(r.name, `DELETE FROM document_types WHERE key = 'ktp';`)
  assert.notEqual(del.code, 0, 'FK Restrict')
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
