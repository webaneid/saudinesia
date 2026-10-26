// Uji migrasi KONTRAKSI vendor F5 (prisma/migrations/20261026180000_vendor_single_flow_contract; ADR-0003, docs/arsitektur-vendor.md §3.4).
// Membangun database "pra-migrasi" (semua migrasi KECUALI yang diuji) lalu menyalinnya per skenario (CREATE DATABASE … TEMPLATE), mengisi data
// lama (vendor yang masih ditulis jalur lama pada masa antara F1-F4), dan menjalankan migrasi lewat `prisma migrate deploy` sungguhan.
// Dibuktikan: pengisian ulang benar, data baru tidak tertimpa, kolom lama hilang + NOT NULL berlaku, fail-closed + ATOMIK, tanpa drift skema.
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

const MIGRATION = '20261026180000_vendor_single_flow_contract'
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
    // Bukti bahwa data setup BENAR-BENAR masuk (jangan percaya kode keluar saja).
    const expected = (setup.match(/INSERT INTO vendors/g) ?? []).length + 1 // +1 = vendor sistem "Saudinesia" dari migrasi F1
    const got = Number((await query(name, 'select count(*)::int as n from vendors'))[0]!.n)
    assert.equal(got, expected, `setup tidak masuk ke DB (vendors: ${got}, seharusnya ${expected}):\n${r.out.slice(-300)}`)
  }
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ...res }
}
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const legacyRow = (i: number, name: string, category: string | null, country: string, contact: string | null) =>
  `INSERT INTO vendors (id, name, category, country, "contactInfo") VALUES ('${id(i)}', '${name}', ${category ? `'${category}'` : 'NULL'}, '${country}', ${contact ? `'${contact}'` : 'NULL'});`
const hasLegacyColumns = async (name: string) =>
  Number((await query(name, `select count(*)::int as n from information_schema.columns where table_name = 'vendors' and column_name in ('category', 'country', 'contactInfo')`))[0]!.n)

console.log('== skenario ==')

await t('vendor ber-legacy diisi ulang (negara→ISO, nameKey, kategori→baku, contactInfo→notes); vendor yang sudah baru TIDAK tertimpa; kolom lama hilang', async () => {
  const r = await scenario([
    legacyRow(1, '  Saudia   Air ', 'maskapai', 'Saudi Arabia', 'CP: 0812-xxxx'),
    legacyRow(2, 'Mas Adam', 'hotel', 'Saudi Arabia', null),
    legacyRow(3, 'Ahmad Guide', 'tour_package', 'Indonesia', 'wa 0813'),
    legacyRow(4, 'Tanpa Kategori', null, 'Saudi Arabia', null),
    // vendor dari alur BARU: kolom baru terisi, contactInfo lama (kalau ada) TIDAK boleh menimpa catatan baru
    `INSERT INTO vendors (id, name, "nameKey", "countryCode", notes, category, "contactInfo") VALUES ('${id(5)}', 'Sudah Baru', 'sudah baru', 'SA', 'catatan baru', 'hotel', 'sisa lama');`,
    `INSERT INTO "_VendorToVendorCategory" ("A", "B") SELECT '${id(5)}', id FROM vendor_categories WHERE slug = 'catering';`,
    `INSERT INTO preferred_vendors (id, "productType", "productId", "costComponent", "vendorId") VALUES ('${id(100)}', 'visa', '${id(200)}', 'individu', '${id(2)}');`,
  ].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  const rows = await query(r.name, `select v.id, v."nameKey", v."countryCode", v.notes,
    coalesce((select string_agg(c.slug, ',' order by c.slug) from "_VendorToVendorCategory" p join vendor_categories c on c.id = p."B" where p."A" = v.id), '') as cats from vendors v order by v.id`)
  const by = Object.fromEntries(rows.map((x) => [String(x.id), x]))
  const row = (i: number) => by[id(i)]!
  assert.equal(row(1).nameKey, 'saudia air'); assert.equal(row(1).countryCode, 'SA'); assert.equal(row(1).cats, 'airline'); assert.equal(row(1).notes, 'CP: 0812-xxxx')
  assert.equal(row(2).cats, 'hotel'); assert.equal(row(2).notes, null)
  assert.equal(row(3).countryCode, 'ID'); assert.equal(row(3).cats, 'other'); assert.equal(row(3).notes, 'wa 0813\nKategori lama: tour_package')
  assert.equal(row(4).cats, 'other')
  assert.equal(row(5).notes, 'catatan baru', 'vendor baru tak boleh tertimpa contactInfo lama'); assert.equal(row(5).cats, 'catering', 'kategori baru tak ditimpa kategori lama')
  assert.equal(rows.length, 6, 'enam vendor: lima uji + vendor sistem Saudinesia'); assert.ok(rows.some((x) => x.id !== undefined))
  assert.equal(await hasLegacyColumns(r.name), 0, 'kolom lama harus hilang')
  const pv = await query(r.name, `select count(*)::int as n from preferred_vendors where "vendorId" = '${id(2)}'`)
  assert.equal(Number(pv[0]!.n), 1, 'vendor pilihan tetap utuh')
})

await t('NOT NULL berlaku: vendor tanpa nameKey/countryCode ditolak DB; keunikan (nameKey, countryCode) tetap', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-400))
  const nullKey = exec(r.name, `INSERT INTO vendors (id, name, "countryCode") VALUES ('${id(1)}', 'X', 'SA');`)
  assert.notEqual(nullKey.code, 0); assert.match(nullKey.out, /Failing row|null value|not-null/i)
  const nullCountry = exec(r.name, `INSERT INTO vendors (id, name, "nameKey") VALUES ('${id(2)}', 'X', 'x');`)
  assert.notEqual(nullCountry.code, 0); assert.match(nullCountry.out, /Failing row|null value|not-null/i)
  const dup = exec(r.name, `INSERT INTO vendors (id, name, "nameKey", "countryCode") VALUES ('${id(3)}', 'Saudinesia', 'saudinesia', 'ID');`)
  assert.notEqual(dup.code, 0); assert.match(dup.out, /vendors_nameKey_countryCode_key|unique/i)
})

await t('FAIL-CLOSED + ATOMIK: nama negara tak dikenal pada vendor ber-legacy membatalkan migrasi; kolom lama TETAP ada', async () => {
  const r = await scenario(legacyRow(1, 'Vendor Atlantis', 'hotel', 'Atlantis', null))
  assert.notEqual(r.code, 0); assert.match(r.out, /DIBATALKAN[\s\S]*negara tak dikenal[\s\S]*Atlantis/)
  assert.equal(await hasLegacyColumns(r.name), 3)
  const nullable = await query(r.name, `select is_nullable from information_schema.columns where table_name = 'vendors' and column_name = 'nameKey'`)
  assert.equal(nullable[0]!.is_nullable, 'YES', 'NOT NULL tidak boleh terpasang sebagian')
})

await t('FAIL-CLOSED + ATOMIK: vendor ganda setelah pengisian ulang (lama vs baru, negara sama) membatalkan migrasi; negara berbeda diizinkan', async () => {
  const newRow = (i: number, cc: string) => `INSERT INTO vendors (id, name, "nameKey", "countryCode") VALUES ('${id(i)}', 'Mas Adam', 'mas adam', '${cc}');`
  const dup = await scenario([legacyRow(1, ' mas  ADAM ', 'hotel', 'Saudi Arabia', null), newRow(2, 'SA')].join('\n'))
  assert.notEqual(dup.code, 0); assert.match(dup.out, /DIBATALKAN[\s\S]*vendor ganda[\s\S]*mas adam/)
  assert.equal(await hasLegacyColumns(dup.name), 3)
  const ok = await scenario([legacyRow(1, ' mas  ADAM ', 'hotel', 'Indonesia', null), newRow(2, 'SA')].join('\n'))
  assert.equal(ok.code, 0, ok.out.slice(-400))
})

await t('skema hasil SEMUA migrasi == schema.prisma (tidak ada drift): prisma migrate diff', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0)
  const diff = run(dbUrl(r.name), ['migrate', 'diff', '--from-url', dbUrl(r.name), '--to-schema-datamodel', 'schema.prisma', '--script'])
  assert.match(diff.out, /empty migration/i, `masih ada drift:\n${diff.out.slice(-500)}`)
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
