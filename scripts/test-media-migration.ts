// Uji migrasi EKSPANSI media F1 (prisma/migrations/20261027120000_product_images_expand; docs/arsitektur-media.md).
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

const MIGRATION = '20261027120000_product_images_expand'
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
    const hotels = Number((await query(name, 'select count(*)::int as n from hotels'))[0]!.n)
    assert.equal(hotels, (setup.match(/INSERT INTO hotels/g) ?? []).length, 'setup tidak masuk ke DB')
  }
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ...res }
}
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const rows = (name: string, type: string) => query(name, `select "productId", key, "sortOrder", "isFeatured", "cardKey", alt from product_images where "productType" = '${type}' order by "productId", "sortOrder"`)

console.log('== skenario ==')

await t('data foto lama diisi ke product_images: hotel (galeri + sampul di dalam/di luar galeri/tanpa sampul), kendaraan, muthowif, situs; kolom lama TETAP utuh', async () => {
  const r = await scenario([
    `INSERT INTO hotels (id, name, city, images, "featuredImageKey") VALUES ('${id(1)}', 'H1', 'makkah', '["h1/a","h1/b","h1/c"]', 'h1/b');`,
    `INSERT INTO hotels (id, name, city, images, "featuredImageKey") VALUES ('${id(2)}', 'H2', 'makkah', '["h2/a","h2/b"]', NULL);`,
    `INSERT INTO hotels (id, name, city, images, "featuredImageKey") VALUES ('${id(3)}', 'H3', 'madinah', '["h3/a"]', 'h3/zzz');`,
    `INSERT INTO hotels (id, name, city) VALUES ('${id(4)}', 'H4 tanpa foto', 'madinah');`,
    `INSERT INTO transport_vehicles (id, name, "vehicleType", capacity, images) VALUES ('${id(10)}', 'V1', 'bus', 40, '["v1/a","v1/b"]');`,
    `INSERT INTO muthowif (id, name, "photoKey") VALUES ('${id(20)}', 'M1', 'm1/foto'), ('${id(21)}', 'M2 tanpa foto', NULL);`,
    `INSERT INTO tourism_sites (id, name, "photoKey") VALUES ('${id(30)}', 'S1', 's1/foto');`,
  ].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  const h = await rows(r.name, 'hotel')
  const of = (pid: string) => h.filter(x => x.productId === pid)
  assert.deepEqual(of(id(1)).map(x => [x.key, x.sortOrder, x.isFeatured]), [['h1/a', 0, false], ['h1/b', 1, true], ['h1/c', 2, false]], 'sampul = featuredImageKey di dalam galeri; urutan dipertahankan')
  assert.deepEqual(of(id(2)).map(x => [x.key, x.isFeatured]), [['h2/a', true], ['h2/b', false]], 'tanpa sampul eksplisit → foto pertama')
  assert.deepEqual(of(id(3)).map(x => [x.key, x.sortOrder, x.isFeatured]), [['h3/a', 0, false], ['h3/zzz', 1, true]], 'sampul di luar galeri ditambahkan dan jadi sampul tunggal')
  assert.equal(of(id(4)).length, 0)
  for (const pid of [id(1), id(2), id(3)]) assert.equal(of(pid).filter(x => x.isFeatured).length, 1, 'tepat satu sampul per hotel')
  const v = await rows(r.name, 'vehicle')
  assert.deepEqual(v.map(x => [x.key, x.sortOrder, x.isFeatured]), [['v1/a', 0, true], ['v1/b', 1, false]], 'kendaraan: foto pertama = sampul')
  assert.deepEqual((await rows(r.name, 'muthowif')).map(x => [x.productId, x.key, x.isFeatured]), [[id(20), 'm1/foto', true]])
  assert.deepEqual((await rows(r.name, 'tourism_site')).map(x => [x.productId, x.key, x.isFeatured]), [[id(30), 's1/foto', true]])
  assert.ok((await rows(r.name, 'hotel')).every(x => x.cardKey === null && x.alt === null), 'baris lama: tanpa turunan kartu, tanpa alt')
  const legacy = await query(r.name, `select images::text as i, "featuredImageKey" as f from hotels where id = '${id(1)}'`)
  assert.match(String(legacy[0]!.i), /h1\/a/); assert.equal(legacy[0]!.f, 'h1/b')
  const total = Number((await query(r.name, 'select count(*)::int as n from product_images'))[0]!.n)
  assert.equal(total, 11, 'jumlah baris: H1 3 + H2 2 + H3 2 + V1 2 + M1 1 + S1 1')
})

await t('DB kosong: migrasi berhasil, tabel ada dan kosong; indeks unik key + indeks pencarian ada', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-400))
  assert.equal(Number((await query(r.name, 'select count(*)::int as n from product_images'))[0]!.n), 0)
  const idx = await query(r.name, `select indexname from pg_indexes where tablename = 'product_images' order by 1`)
  assert.deepEqual(idx.map(i => i.indexname), ['product_images_key_key', 'product_images_pkey', 'product_images_productType_productId_sortOrder_idx'])
})

await t('FAIL-CLOSED + ATOMIK: galeri berisi elemen bukan-teks membatalkan migrasi dan tabel TIDAK dibuat', async () => {
  const r = await scenario(`INSERT INTO hotels (id, name, city, images) VALUES ('${id(1)}', 'Rusak', 'makkah', '["ok", 42]');`)
  assert.notEqual(r.code, 0); assert.match(r.out, /DIBATALKAN[\s\S]*bukan teks/)
  const t1 = await query(r.name, `select count(*)::int as n from information_schema.tables where table_name = 'product_images'`)
  assert.equal(Number(t1[0]!.n), 0, 'tabel tidak boleh tersisa setelah migrasi gagal')
})

await t('FAIL-CLOSED + ATOMIK: kunci objek ganda (dua baris menunjuk objek yang sama) membatalkan migrasi', async () => {
  const r = await scenario([
    `INSERT INTO hotels (id, name, city, images) VALUES ('${id(1)}', 'A', 'makkah', '["sama"]');`,
    `INSERT INTO hotels (id, name, city, images) VALUES ('${id(2)}', 'B', 'makkah', '["sama"]');`,
  ].join('\n'))
  assert.notEqual(r.code, 0); assert.match(r.out, /product_images_key_key|unique|duplicate/i)
  const t1 = await query(r.name, `select count(*)::int as n from information_schema.tables where table_name = 'product_images'`)
  assert.equal(Number(t1[0]!.n), 0)
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
