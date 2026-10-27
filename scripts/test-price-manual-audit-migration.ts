// Uji migrasi audit harga manual (prisma/migrations/20261028160000_price_manual_audit; docs/arsitektur-harga-terpadu.md §16, Fase 3).
// Membangun database "pra-migrasi", mengisi data lama lewat ORM, lalu `prisma migrate deploy` sungguhan. Dibuktikan: kolom audit + tabel price_changes + ambang margin,
// tarif muthowif dijaga SATU baris oleh DB (dedupe mempertahankan baris berbiaya, baris polimorfik yatim ikut bersih, baris kedua & singleton=false ditolak),
// override jual Visa di JSON tier dipindah ke harga manual titik harga (+ jejak) dan kuncinya dibuang dari JSON tanpa merusak kunci lain.
//
// PENGAMAN: membuat/menghapus database sementara `<db>_tmp_*` di server yang sama — menolak jalan kecuali DATABASE_URL adalah DB uji.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

const MIGRATION = '20261028160000_price_manual_audit'
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

async function scenarioWith(fixtures: (db: PrismaClient) => Promise<Record<string, string>>) {
  const name = `${mainName}${suffix}_s${++n}`
  await newDb(name, baseName)
  const db = new PrismaClient({ datasourceUrl: dbUrl(name) })
  let ids: Record<string, string>
  try { ids = await fixtures(db) } finally { await db.$disconnect() }
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ids, ...res }
}
const flat = (cost: number, extra: Record<string, unknown> = {}) => ({ minDays: 1, maxDays: 14, cost, ...extra })

console.log('== skenario ==')

await t('kolom audit + price_changes + warnBelowPercent (default 0, negatif ditolak)', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const cols = await query(r.name, `select column_name as c from information_schema.columns where table_name = 'price_points' and column_name in ('manualBy','manualAt')`)
  assert.equal(cols.length, 2)
  assert.equal(Number((await query(r.name, `select count(*)::int as n from price_changes`))[0]!.n), 0)
  await exec(r.name, `INSERT INTO pricing_rules (id, "productType", "minMarginPercent", "roundingIncrement", "updatedAt") VALUES ('00000000-0000-4000-8000-000000000001', 'global', 20, 50000, now());`)
  assert.equal(Number((await query(r.name, `select "warnBelowPercent"::float as w from pricing_rules`))[0]!.w), 0)
  assert.notEqual(exec(r.name, `UPDATE pricing_rules SET "warnBelowPercent" = -1`).code, 0, 'ambang negatif ditolak')
})

await t('muthowif: dua baris → SATU tersisa (yang berbiaya), biaya/vendor/titik harga yatim ikut bersih; baris kedua dan singleton=false ditolak DB', async () => {
  const r = await scenarioWith(async db => {
    const vendor = await db.vendor.create({ data: { name: 'V', nameKey: 'v', countryCode: 'SA' } })
    // Tabel yang diubah migrasi ini (muthowif_service_price, price_points) diisi lewat SQL: client Prisma terbaru sudah mengenal kolom baru, DB pra-migrasi belum.
    const seedRow = { id: String((await db.$queryRawUnsafe<Array<{ id: string }>>(`select id from muthowif_service_price limit 1`))[0]!.id) }
    const costed = { id: '00000000-0000-4000-8000-0000000000aa' }
    await db.$executeRawUnsafe(`insert into muthowif_service_price (id, price, "updatedAt") values ('${costed.id}', 450000, now())`)
    await db.productCost.create({ data: { productType: 'muthowif', productId: costed.id, vendorId: vendor.id, costComponent: 'layanan', currency: 'IDR', costTiers: [flat(360_000)] } })
    await db.preferredVendor.create({ data: { productType: 'muthowif', productId: costed.id, costComponent: 'layanan', vendorId: vendor.id } })
    await db.productCost.create({ data: { productType: 'muthowif', productId: seedRow.id, vendorId: vendor.id, costComponent: 'sisa', currency: 'IDR', costTiers: [flat(1)] } })
    await db.$executeRawUnsafe(`insert into price_points (id, "ownerType", "ownerId", "variantKey", unit, "autoSellIdr", "sellIdr", "updatedAt") values (gen_random_uuid()::text, 'muthowif', '${seedRow.id}', '', 'person_day', 300000, 300000, now()) on conflict do nothing`) // migrasi backfill Fase 2 sudah membuat titik untuk baris bawaan
    return { keep: costed.id, drop: seedRow.id }
  })
  // baris bawaan migrasi lama juga punya biaya di fixture → keduanya "berbiaya": yang terbaru diubah menang. Pastikan tepat satu dan konsisten.
  assert.equal(r.code, 0, r.out.slice(-500))
  const rows = await query(r.name, `select id from muthowif_service_price`)
  assert.equal(rows.length, 1, 'tepat satu baris')
  const keep = String(rows[0]!.id)
  const other = keep === r.ids.keep ? r.ids.drop! : r.ids.keep!
  for (const t of ['product_costs', 'preferred_vendors']) {
    assert.equal(Number((await query(r.name, `select count(*)::int as n from ${t} where "productType" = 'muthowif' and "productId" = '${other}'`))[0]!.n), 0, `${t} yatim harus bersih`)
  }
  assert.equal(Number((await query(r.name, `select count(*)::int as n from price_points where "ownerType" = 'muthowif' and "ownerId" = '${other}'`))[0]!.n), 0)
  assert.notEqual(exec(r.name, `INSERT INTO muthowif_service_price (id, price, "updatedAt") VALUES ('x-second', 1, now());`).code, 0, 'baris kedua ditolak oleh indeks unik')
  assert.notEqual(exec(r.name, `UPDATE muthowif_service_price SET singleton = false`).code, 0, 'singleton=false ditolak oleh CHECK')
})

await t('muthowif: baris berbiaya dipertahankan walau yang tak berbiaya lebih baru', async () => {
  const r = await scenarioWith(async db => {
    const vendor = await db.vendor.create({ data: { name: 'V2', nameKey: 'v2', countryCode: 'SA' } })
    const seedRow = { id: String((await db.$queryRawUnsafe<Array<{ id: string }>>(`select id from muthowif_service_price limit 1`))[0]!.id) }
    await db.productCost.create({ data: { productType: 'muthowif', productId: seedRow.id, vendorId: vendor.id, costComponent: 'layanan', currency: 'IDR', costTiers: [flat(360_000)] } })
    const newer = { id: '00000000-0000-4000-8000-0000000000bb' }
    await db.$executeRawUnsafe(`insert into muthowif_service_price (id, price, "updatedAt") values ('${newer.id}', 999, now() + interval '1 day')`) // lebih baru, tanpa biaya
    return { keep: seedRow.id, newer: newer.id }
  })
  assert.equal(r.code, 0, r.out.slice(-500))
  assert.deepEqual((await query(r.name, `select id from muthowif_service_price`)).map(x => x.id), [r.ids.keep])
})

await t('override jual Visa: dipindah ke harga MANUAL titik harga (+ jejak), kunci dibuang dari JSON, kunci lain & tier tanpa override utuh', async () => {
  const r = await scenarioWith(async db => {
    const vendor = await db.vendor.create({ data: { name: 'V3', nameKey: 'v3', countryCode: 'SA' } })
    const visa = await db.visaProduct.create({ data: { name: 'V', visaType: 'Umroh', price: 0, durationFeeRules: [] } })
    await db.productCost.create({ data: { productType: 'visa', productId: visa.id, vendorId: vendor.id, costComponent: 'individu', currency: 'IDR',
      costTiers: [flat(1_000_000, { sellPriceOverride: 1_100_000 }), { minDays: 15, maxDays: 30, cost: 2_000_000 }, { minDays: 31, maxDays: 40, cost: 3_000_000, sellPriceOverride: 3_500_000 }] } })
    // komponen kedua dengan override pada varian yang sama (kasus tak lazim): menang yang id-nya terkecil (deterministik)
    await db.productCost.create({ data: { productType: 'visa', productId: visa.id, vendorId: vendor.id, costComponent: 'brn', currency: 'IDR', costTiers: [flat(100_000, { sellPriceOverride: 9_999_999 })] } })
    for (const [vk, sell] of [['days:1-14', 1_100_000], ['days:15-30', 2_400_000]] as const) {
      await db.$executeRawUnsafe(`insert into price_points (id, "ownerType", "ownerId", "variantKey", unit, "autoSellIdr", "sellIdr", "updatedAt") values (gen_random_uuid()::text, 'visa', '${visa.id}', '${vk}', 'person', ${sell}, ${sell}, now())`)
    }
    return { visa: visa.id }
  })
  assert.equal(r.code, 0, r.out.slice(-500))
  const pts = await query(r.name, `select "variantKey" as v, "autoSellIdr"::float as auto, "manualSellIdr"::float as manual, "sellIdr"::float as sell, "manualNote" as note from price_points where "ownerType" = 'visa' order by 1`)
  assert.equal(pts.length, 2)
  const winner = (await query(r.name, `select "costComponent" as c from product_costs where "productType" = 'visa' order by id limit 1`))[0]!.c
  const expected = winner === 'individu' ? 1_100_000 : 9_999_999 // sebelum kunci dibuang, pemenang = id terkecil; nilainya sudah tercermin di manual
  assert.deepEqual([pts[0]!.v, pts[0]!.manual, pts[0]!.sell], ['days:1-14', expected, expected], 'override tier 1 jadi harga manual (pemenang = komponen ber-id terkecil)')
  assert.match(String(pts[0]!.note), /override/i)
  assert.deepEqual([pts[1]!.v, pts[1]!.manual, pts[1]!.sell], ['days:15-30', null, 2_400_000], 'tier tanpa override tak disentuh')
  const changes = await query(r.name, `select "variantKey" as v, kind, "newSellIdr"::float as n, "byUserId" as by from price_changes order by 1`)
  assert.deepEqual(changes.map(c => [c.v, c.kind, c.n, c.by]), [['days:1-14', 'visa_override_migrated', expected, null]], 'override pada varian tanpa titik harga TIDAK dicatat; sistem = byUserId null')
  const costs = await query(r.name, `select "costComponent" as c, "costTiers"::text as t from product_costs where "productType" = 'visa' order by 1`)
  for (const c of costs) assert.doesNotMatch(String(c.t), /sellPriceOverride/, `kunci override harus terbuang dari ${c.c}`)
  assert.match(String(costs.find(c => c.c === 'individu')!.t), /"cost": 2000000/, 'kunci lain utuh')
  assert.equal(JSON.parse(String(costs.find(c => c.c === 'individu')!.t)).length, 3, 'jumlah tier tetap')
})

await t('tanpa Visa/override: migrasi berhasil dan tak mengubah apa pun (tabel kosong)', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0, r.out.slice(-300))
  assert.equal(Number((await query(r.name, `select count(*)::int as n from price_changes`))[0]!.n), 0)
})

// Uji drift skema ada di migrasi TERBARU (scripts/test-price-manual-owners-migration.ts) — di sini skema sudah lebih maju dari migrasi yang diuji.

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
