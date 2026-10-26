// Uji migrasi vendor F1 (prisma/migrations/20261026120000_vendor_single_flow_expand; ADR-0003, docs/arsitektur-vendor.md §3.4).
// Membangun database "pra-migrasi" (semua migrasi KECUALI yang diuji) lalu menyalinnya per skenario (CREATE DATABASE … TEMPLATE), mengisi data
// lama, dan menjalankan migrasi lewat `prisma migrate deploy` sungguhan. Yang dibuktikan: pemetaan benar, fail-closed (negara tak dikenal,
// tabrakan nama, vendor pilihan yatim, "Saudinesia" bentrok) dan ATOMIK (gagal = tidak ada perubahan struktur sama sekali).
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

const MIGRATION = '20261026120000_vendor_single_flow_expand'
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
  if (d >= MIGRATION || d.endsWith('.toml')) continue // migrasi yang diuji + yang lebih baru (mis. kontraksi F5) tidak ikut DB pra-migrasi
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
    // Bukti bahwa data setup BENAR-BENAR masuk (jangan percaya kode keluar saja).
    const expected = (setup.match(/INSERT INTO vendors/g) ?? []).length
    const got = Number((await query(name, 'select count(*)::int as n from vendors'))[0]!.n)
    assert.equal(got, expected, `setup tidak masuk ke DB (vendors: ${got}, seharusnya ${expected}):\n${r.out.slice(-300)}`)
  }
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ...res }
}
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const vendorsSql = (rows: Array<[number, string, string | null, string, string | null]>) =>
  rows.map(([i, name, category, country, contact]) => `INSERT INTO vendors (id, name, category, country, "contactInfo") VALUES ('${id(i)}', '${name}', ${category ? `'${category}'` : 'NULL'}, '${country}', ${contact ? `'${contact}'` : 'NULL'});`).join('\n')
const noNewStructure = async (name: string) => {
  const t = await query(name, `select count(*)::int as n from information_schema.tables where table_name = 'vendor_categories'`)
  const c = await query(name, `select count(*)::int as n from information_schema.columns where table_name = 'vendors' and column_name = 'nameKey'`)
  return { tables: Number(t[0]!.n), columns: Number(c[0]!.n) }
}

console.log('== skenario ==')

await t('data lama dipetakan benar: kategori→baku (many-to-many), negara→ISO, nameKey, contactInfo→notes, kategori label-modul→other + catatan; kolom legacy utuh; FK vendor pilihan terpasang', async () => {
  const r = await scenario(`${vendorsSql([
    [1, 'BRN', 'syarikah', 'Saudi Arabia', null],
    [2, '  Saudia   Air ', 'maskapai', 'Saudi Arabia', 'CP: 0812-xxxx'],
    [3, 'Mas Adam', 'hotel', 'Saudi Arabia', null],
    [4, 'Al-Rajhi Bus', 'transport', 'Saudi Arabia', ''],
    [5, 'Ahmad Guide', 'tour_package', 'Saudi Arabia', 'wa 0813'],
    [6, 'wasugi', 'package', 'Indonesia', null],
    [7, 'Tanpa Kategori', null, 'Indonesia', null],
    [8, 'Kategori Aneh', 'xyz', 'Saudi Arabia', null],
    [9, 'Saudinesia', 'internal', 'Indonesia', null],
  ])}
INSERT INTO preferred_vendors (id, "productType", "productId", "costComponent", "vendorId") VALUES ('${id(100)}', 'visa', '${id(200)}', 'individu', '${id(1)}');`)
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  const rows = await query(r.name, `select v.id, v."nameKey", v."countryCode", v."systemKey", v.notes, v.category, v.country, v."contactInfo",
    coalesce((select string_agg(c.slug, ',' order by c.slug) from "_VendorToVendorCategory" p join vendor_categories c on c.id = p."B" where p."A" = v.id), '') as cats from vendors v order by v.id`)
  const by = Object.fromEntries(rows.map((x) => [String(x.id), x]))
  const row = (i: number) => by[id(i)]!
  assert.equal(row(1).cats, 'visa'); assert.equal(row(2).cats, 'airline'); assert.equal(row(3).cats, 'hotel'); assert.equal(row(4).cats, 'transport')
  assert.equal(row(5).cats, 'other'); assert.equal(row(6).cats, 'other'); assert.equal(row(7).cats, 'other'); assert.equal(row(8).cats, 'other'); assert.equal(row(9).cats, 'internal')
  assert.equal(row(1).countryCode, 'SA'); assert.equal(row(6).countryCode, 'ID')
  assert.equal(row(2).nameKey, 'saudia air', 'spasi dipangkas dan dilipat, huruf kecil')
  assert.equal(row(2).notes, 'CP: 0812-xxxx'); assert.equal(row(4).notes, null, 'contactInfo kosong → tanpa catatan')
  assert.equal(row(5).notes, 'wa 0813\nKategori lama: tour_package', 'kontak lama + label modul lama tercatat untuk ditinjau')
  assert.equal(row(7).notes, null); assert.equal(row(8).notes, 'Kategori lama: xyz')
  assert.equal(row(9).systemKey, 'saudinesia', 'vendor internal yang ada DITANDAI, bukan dibuat ganda')
  assert.equal(rows.length, 9, 'tidak ada vendor yang hilang/bertambah')
  assert.equal(row(1).category, 'syarikah'); assert.equal(row(1).country, 'Saudi Arabia'); assert.equal(row(5).contactInfo, 'wa 0813') // legacy utuh sampai F5
  const fk = await query(r.name, `select count(*)::int as n from pg_constraint where conname = 'preferred_vendors_vendorId_fkey'`)
  assert.equal(Number(fk[0]!.n), 1)
  const cats = await query(r.name, `select slug from vendor_categories where "isSystem" order by "sortOrder"`)
  assert.deepEqual(cats.map((c) => c.slug), ['hotel', 'transport', 'airline', 'visa', 'catering', 'guide', 'tour-operator', 'internal', 'other'])
})

await t('DB kosong (kasus CI): kategori sistem + vendor sistem "Saudinesia" (internal, ID) dibuat; keunikan (nameKey, countryCode) berlaku', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-400))
  const sys = await query(r.name, `select v.name, v."countryCode", v."systemKey", v.category, (select c.slug from "_VendorToVendorCategory" p join vendor_categories c on c.id = p."B" where p."A" = v.id) as cat from vendors v`)
  assert.deepEqual(sys, [{ name: 'Saudinesia', countryCode: 'ID', systemKey: 'saudinesia', category: 'internal', cat: 'internal' }])
  const dup = exec(r.name, `INSERT INTO vendors (id, name, "nameKey", "countryCode", country) VALUES ('${id(1)}', 'Saudinesia', 'saudinesia', 'ID', 'Indonesia');`)
  assert.notEqual(dup.code, 0, 'duplikat (nameKey, countryCode) harus ditolak oleh indeks unik')
  assert.match(dup.out, /vendors_nameKey_countryCode_key|duplicate key|unique/i, `penolakan harus oleh indeks unik, bukan hal lain:\n${dup.out.slice(-300)}`)
})

await t('FAIL-CLOSED + ATOMIK: nama negara tak dikenal membatalkan migrasi dan struktur baru TIDAK ada sama sekali', async () => {
  const r = await scenario(vendorsSql([[1, 'Vendor Atlantis', 'hotel', 'Atlantis', null]]))
  assert.notEqual(r.code, 0); assert.match(r.out, /DIBATALKAN[\s\S]*negara tak dikenal[\s\S]*Atlantis/)
  assert.deepEqual(await noNewStructure(r.name), { tables: 0, columns: 0 })
})

await t('FAIL-CLOSED + ATOMIK: vendor ganda (nama sama setelah dinormalisasi, negara sama) membatalkan migrasi; negara berbeda diizinkan', async () => {
  const dup = await scenario(vendorsSql([[1, 'Mas Adam', 'hotel', 'Saudi Arabia', null], [2, ' mas  ADAM ', 'package', 'Saudi Arabia', null]]))
  assert.notEqual(dup.code, 0); assert.match(dup.out, /DIBATALKAN[\s\S]*vendor ganda[\s\S]*mas adam/)
  assert.deepEqual(await noNewStructure(dup.name), { tables: 0, columns: 0 })
  const ok = await scenario(vendorsSql([[1, 'Mas Adam', 'hotel', 'Saudi Arabia', null], [2, 'Mas Adam', 'hotel', 'Indonesia', null]]))
  assert.equal(ok.code, 0, ok.out.slice(-400))
})

await t('FAIL-CLOSED + ATOMIK: vendor pilihan yatim (vendorId tak ada) membatalkan migrasi', async () => {
  const r = await scenario(`INSERT INTO preferred_vendors (id, "productType", "productId", "costComponent", "vendorId") VALUES ('${id(100)}', 'visa', '${id(200)}', 'individu', '${id(999)}');`)
  assert.notEqual(r.code, 0); assert.match(r.out, /DIBATALKAN[\s\S]*yatim/)
  assert.deepEqual(await noNewStructure(r.name), { tables: 0, columns: 0 })
})

await t('FAIL-CLOSED + ATOMIK: vendor "Saudinesia" (ID) yang BUKAN internal membatalkan migrasi (tidak membuat/menimpa diam-diam)', async () => {
  const r = await scenario(vendorsSql([[1, 'Saudinesia', 'hotel', 'Indonesia', null]]))
  assert.notEqual(r.code, 0); assert.match(r.out, /DIBATALKAN[\s\S]*Saudinesia/)
  assert.deepEqual(await noNewStructure(r.name), { tables: 0, columns: 0 })
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
