// Uji migrasi KONTRAKSI media F4 (prisma/migrations/20261027180000_product_images_contract; docs/arsitektur-media.md): kolom foto lama dibuang,
// product_images dan data produk TIDAK tersentuh, fail-closed bila ekspansi belum diterapkan, dan skema hasil SEMUA migrasi == schema.prisma.
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

const MIGRATION = '20261027180000_product_images_contract'
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
const legacyColumns = async (name: string) => (await query(name, `select table_name || '.' || column_name as c from information_schema.columns
  where (table_name = 'hotels' and column_name in ('images', 'featuredImageKey')) or (table_name = 'transport_vehicles' and column_name = 'images')
     or (table_name = 'muthowif' and column_name = 'photoKey') or (table_name = 'tourism_sites' and column_name = 'photoKey')
     or (table_name = 'haji_products' and column_name = 'images') or (table_name = 'packages' and column_name = 'images') order by 1`)).map(r => String(r.c))

console.log('== skenario ==')

await t('kolom foto lama (7) dibuang; product_images dan baris produk TIDAK tersentuh', async () => {
  const r = await scenario([
    `INSERT INTO hotels (id, name, city, images, "featuredImageKey") VALUES ('${id(1)}', 'H1', 'makkah', '["h1/a"]', 'h1/a');`,
    `INSERT INTO muthowif (id, name, "photoKey") VALUES ('${id(2)}', 'M1', 'm1/foto');`,
    `INSERT INTO product_images (id, "productType", "productId", key, "sortOrder", "isFeatured") VALUES ('${id(10)}', 'hotel', '${id(1)}', 'h1/a', 0, true), ('${id(11)}', 'muthowif', '${id(2)}', 'm1/foto', 0, true), ('${id(12)}', 'hotel', '${id(1)}', 'h1/baru-setelah-ekspansi', 1, false);`,
  ].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  assert.deepEqual(await legacyColumns(r.name), [], 'semua kolom foto lama harus hilang')
  const rows = await query(r.name, `select key, "isFeatured" from product_images order by key`)
  assert.deepEqual(rows.map(x => [x.key, x.isFeatured]), [['h1/a', true], ['h1/baru-setelah-ekspansi', false], ['m1/foto', true]], 'foto di product_images utuh (termasuk yang ditambah setelah ekspansi)')
  assert.equal(Number((await query(r.name, `select count(*)::int as n from hotels where name = 'H1'`))[0]!.n), 1, 'baris hotel tetap')
  assert.equal(Number((await query(r.name, `select count(*)::int as n from muthowif where name = 'M1'`))[0]!.n), 1, 'baris muthowif tetap')
})

await t('DB kosong: kontraksi berhasil dan kolom lama hilang', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-400)); assert.deepEqual(await legacyColumns(r.name), [])
})

await t('FAIL-CLOSED + ATOMIK: tanpa tabel product_images (ekspansi belum diterapkan) kontraksi dibatalkan dan kolom lama TETAP ada', async () => {
  const r = await scenario('DROP TABLE product_images;')
  assert.notEqual(r.code, 0); assert.match(r.out, /DIBATALKAN[\s\S]*product_images/)
  assert.equal((await legacyColumns(r.name)).length, 7, 'tak satu kolom pun boleh terhapus saat migrasi gagal')
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
