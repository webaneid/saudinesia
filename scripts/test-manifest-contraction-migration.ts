// Uji migrasi kontraksi kolom data jamaah per produk (prisma/migrations/20261213090000_manifest_field_contraction, docs/arsitektur-data-jamaah.md D5):
// tabel `manifest_field_requirements` dihapus FAIL-CLOSED (berhenti bila isian jamaah kehilangan satu-satunya definisinya); isian jamaah tak disentuh.
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

const MIGRATION = '20261213090000_manifest_field_contraction'
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
const tmp = mkdtempSync(join(tmpdir(), 'mfcontract-mig-'))
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

let seq = 0
const field = (key: string, o: { role?: string | null; type?: string; product?: string; productType?: string } = {}) =>
  `INSERT INTO manifest_field_requirements (id, "productType", "productId", "fieldKey", label, "fieldType", required, "order", role) VALUES ('f${++seq}', '${o.productType ?? 'visa'}', '${o.product ?? 'v1'}', '${key}', '${key}', '${o.type ?? 'text'}', true, 0, ${o.role ? `'${o.role}'` : 'NULL'});`
// Baris jamaah tanpa rantai booking: pemicu FK dimatikan untuk sesi setup saja (superuser lokal/CI).
const pilgrim = (id: string, values: Record<string, unknown>) =>
  `SET session_replication_role = replica; INSERT INTO booking_pilgrims (id, "bookingId", "fieldValues") VALUES ('${id}', 'b-x', '${JSON.stringify(values)}'); SET session_replication_role = DEFAULT;`
const standard = field('fullName', { role: 'display_name' }) + field('gender', { role: 'gender', type: 'select' }) + field('phone', { role: 'phone', type: 'phone' })
const core = field('fullName', { role: 'display_name', productType: 'core', product: 'default' }) + field('gender', { type: 'select', productType: 'core', product: 'default' })
const tableExists = async (db: string) => (await query(db, `select 1 from information_schema.tables where table_name = 'manifest_field_requirements'`)).length === 1
const valuesOf = async (db: string, id: string) => (await query(db, `select "fieldValues" as v from booking_pilgrims where id = '${id}'`))[0]?.v
const blocked = async (setup: string, want: RegExp) => {
  const r = await scenario(setup)
  assert.notEqual(r.code, 0, 'migrasi harus gagal')
  assert.match(r.out, want, r.out.slice(-700))
  assert.equal(await tableExists(r.name), true, 'tabel harus utuh')
}

console.log('== skenario ==')

await t('DB kosong: tabel dihapus', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-600))
  assert.equal(await tableExists(r.name), false)
})
await t('KEADAAN DEV: kolom standar + core + dua kolom K1 (berisi data) → tabel dihapus, isian jamaah tetap utuh', async () => {
  const v = { fullName: 'Budi', phone: { countryCode: 'ID', number: '812' }, nomorHpHost: { countryCode: 'SA', number: '55' }, shortAddressUnwanWathoni_0a1b2c: 'ABCD1234' }
  const r = await scenario(standard + core + field('nomorHpHost', { type: 'phone' }) + field('shortAddressUnwanWathoni_0a1b2c') + pilgrim('p1', v))
  assert.equal(r.code, 0, r.out.slice(-600))
  assert.equal(await tableExists(r.name), false)
  assert.deepEqual(await valuesOf(r.name, 'p1'), v)
})
await t('KONTROL: kolom bebas tanpa padanan yang tak pernah terisi (tak ada kunci, null, kosong, telepon tanpa nomor) → berhasil', async () => {
  const r = await scenario(standard + field('golonganDarah') + field('hpMahram', { type: 'phone' })
    + pilgrim('p1', { fullName: 'A', golonganDarah: '' }) + pilgrim('p2', { golonganDarah: null, hpMahram: { countryCode: 'ID', number: '' } }) + pilgrim('p3', {}))
  assert.equal(r.code, 0, r.out.slice(-600))
})
await t('FAIL-CLOSED: kolom bebas berisi data tanpa padanan katalog → BERHENTI dengan namanya', async () => {
  await blocked(standard + field('golonganDarah') + pilgrim('p1', { golonganDarah: 'O' }), /golonganDarah/)
  await blocked(field('hpMahram', { type: 'phone' }) + pilgrim('p1', { hpMahram: { countryCode: 'ID', number: '812' } }), /hpMahram/)
})
await t('FAIL-CLOSED: nama yang hanya MIRIP kolom K1 tidak ikut dikecualikan', async () => {
  await blocked(field('nomorHpHostel') + pilgrim('p1', { nomorHpHostel: 'x' }), /nomorHpHostel/)
})
await t('FAIL-CLOSED: padanan katalog bertipe lain dan berisi data → BERHENTI', async () => {
  await blocked(field('address', { role: 'address', type: 'text' }) + pilgrim('p1', { address: 'Jl. Mawar' }), /address/)
})
await t('FAIL-CLOSED: kolom berperan berkunci non-standar (dibuat sesudah D1) → BERHENTI', async () => {
  await blocked(field('namaLengkap', { role: 'display_name' }), /non-standar[^\n]*namaLengkap/)
})
await t('KONTROL: kolom berisi data dengan padanan bertipe sama di katalog → berhasil', async () => {
  const r = await scenario(`INSERT INTO pilgrim_fields (id, key, label, "fieldType", "updatedAt") VALUES ('c1', 'golonganDarah', 'Golongan Darah', 'text', timestamptz '2026-11-24');`
    + field('golonganDarah') + pilgrim('p1', { golonganDarah: 'O' }))
  assert.equal(r.code, 0, r.out.slice(-600))
  assert.deepEqual(await valuesOf(r.name, 'p1'), { golonganDarah: 'O' })
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
