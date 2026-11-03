// Uji migrasi prisma/migrations/20261115090000_booking_pilgrim_cards (docs/arsitektur-jamaah.md §5.3, Fase 7a): tabel `documents` lama dihapus
// FAIL-CLOSED (berhenti bila berisi baris), kolom NIK/paspor tersegel jamaah booking ber-CHECK, peran field manifest = daftar tunggal (peran baku
// untuk field seed dikenal; peran tak dikenal / ganda per produk → BERHENTI).
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

const MIGRATION = '20261115090000_booking_pilgrim_cards'
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
const tmp = mkdtempSync(join(tmpdir(), 'bpcards-mig-'))
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
const field = (id: string, product: string, key: string, role: string | null = null, type = 'text') =>
  `INSERT INTO manifest_field_requirements (id, "productType", "productId", "fieldKey", label, "fieldType", required, "order", role) VALUES ('${id}', 'visa', '${product}', '${key}', '${key}', '${type}', true, 0, ${role ? `'${role}'` : 'NULL'});`
// Baris `documents` tanpa rantai booking: pemicu FK dimatikan untuk sesi setup saja (session_replication_role, superuser lokal/CI).
const legacyDoc = `SET session_replication_role = replica; INSERT INTO documents (id, "bookingPilgrimId", "docType", "fileName", "filePath") VALUES ('d1', 'bp-x', 'passport', 'scan.pdf', 'pilgrims/bp-x/passport/1-scan.pdf'); SET session_replication_role = DEFAULT;`
const roleOf = async (db: string, id: string) => (await query(db, `select role from manifest_field_requirements where id = '${id}'`))[0]?.role ?? null
const tableExists = async (db: string, t: string) => (await query(db, `select 1 from information_schema.tables where table_name = '${t}'`)).length === 1

console.log('== skenario ==')

await t('KEADAAN DEV: documents kosong → tabel dihapus; field seed dikenal diberi peran baku; peran yang sudah ada & field tak dikenal tak disentuh', async () => {
  const r = await scenario(field('f1', 'v1', 'fullName', 'display_name') + field('f2', 'v1', 'gender', null, 'select') + field('f3', 'v1', 'dateOfBirth', null, 'date')
    + field('f4', 'v1', 'passportNumber') + field('f5', 'v1', 'nik') + field('f6', 'v1', 'bloodType') + field('f7', 'v2', 'birthDate', null, 'date'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-600)}`)
  assert.equal(await tableExists(r.name, 'documents'), false)
  assert.deepEqual(await Promise.all(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'].map(id => roleOf(r.name, id))), ['display_name', 'gender', 'birth_date', 'passport_number', 'nik', null, 'birth_date'])
  assert.equal((await query(r.name, `select 1 from information_schema.columns where table_name = 'pilgrim_documents' and column_name = 'bookingId'`)).length, 1)
})
await t('FAIL-CLOSED: tabel documents masih berisi baris → BERHENTI, tabel tetap ada', async () => {
  const r = await scenario(legacyDoc)
  assert.notEqual(r.code, 0, 'migrasi harus gagal')
  assert.match(r.out, /documents masih berisi baris/)
  assert.equal(await tableExists(r.name, 'documents'), true)
})
await t('FAIL-CLOSED: peran tak dikenal (role lama bebas teks) → BERHENTI dengan namanya', async () => {
  const r = await scenario(field('g1', 'v3', 'x', 'nomor_kursi'))
  assert.notEqual(r.code, 0)
  assert.match(r.out, /tak dikenal[^\n]*nomor_kursi/, r.out.slice(-700))
})
await t('FAIL-CLOSED: dua field satu produk jadi berperan sama (dateOfBirth + birthDate) → BERHENTI', async () => {
  const r = await scenario(field('h1', 'v4', 'dateOfBirth', null, 'date') + field('h2', 'v4', 'birthDate', null, 'date'))
  assert.notEqual(r.code, 0)
  assert.match(r.out, /dua field/)
})
await t('FAIL-CLOSED: nomor paspor polos sudah ada di snapshot jamaah booking (field yang kini berperan passport_number) → BERHENTI', async () => {
  const pilgrim = `SET session_replication_role = replica; INSERT INTO booking_pilgrims (id, "bookingId", "fieldValues") VALUES ('q1', 'b-x', '{"passportNumber": "X1234567"}'); `
    + `INSERT INTO visa_applications (id, "bookingPilgrimId", "visaProductId", "visaType", status) VALUES ('va1', 'q1', 'v6', 'umrah', 'pending_documents'); SET session_replication_role = DEFAULT;`
  const r = await scenario(field('m1', 'v6', 'passportNumber') + pilgrim)
  assert.notEqual(r.code, 0, 'migrasi harus gagal')
  assert.match(r.out, /polos/, r.out.slice(-700))
})
await t('KONTROL: snapshot kosong di field paspor → migrasi berhasil', async () => {
  const pilgrim = `SET session_replication_role = replica; INSERT INTO booking_pilgrims (id, "bookingId", "fieldValues") VALUES ('q2', 'b-x', '{"passportNumber": ""}'); `
    + `INSERT INTO visa_applications (id, "bookingPilgrimId", "visaProductId", "visaType", status) VALUES ('va2', 'q2', 'v7', 'umrah', 'pending_documents'); SET session_replication_role = DEFAULT;`
  const r = await scenario(field('m2', 'v7', 'passportNumber') + pilgrim)
  assert.equal(r.code, 0, r.out.slice(-700))
})
await t('CHECK sesudah migrasi: NIK harus berpasangan, paspor empat kolom bersama, negara 2 huruf besar, peran di luar daftar ditolak, peran unik per produk', async () => {
  const r = await scenario(field('k1', 'v5', 'fullName', 'display_name'))
  assert.equal(r.code, 0, r.out.slice(-600))
  const setup = `SET session_replication_role = replica; INSERT INTO booking_pilgrims (id, "bookingId") VALUES ('p1', 'b-x'); SET session_replication_role = DEFAULT;`
  assert.equal(exec(r.name, setup).code, 0, 'baris jamaah uji')
  const bad = (sql: string, why: string) => assert.notEqual(exec(r.name, sql).code, 0, why)
  bad(`UPDATE booking_pilgrims SET "nikHash" = 'h' WHERE id = 'p1';`, 'NIK tanpa cipher')
  bad(`UPDATE booking_pilgrims SET "passportCipher" = 'c', "passportKeyHash" = 'k', "passportLast4" = '1234' WHERE id = 'p1';`, 'paspor tanpa negara')
  bad(`UPDATE booking_pilgrims SET "passportCipher" = 'c', "passportKeyHash" = 'k', "passportLast4" = '1234', "passportCountry" = 'idn' WHERE id = 'p1';`, 'negara bukan 2 huruf besar')
  assert.equal(exec(r.name, `UPDATE booking_pilgrims SET "nikHash" = 'h', "nikCipher" = 'c', "passportCipher" = 'c', "passportKeyHash" = 'k', "passportLast4" = '1234', "passportCountry" = 'ID' WHERE id = 'p1';`).code, 0, 'kontrol positif')
  bad(field('k2', 'v5', 'x', 'golongan_darah'), 'peran di luar daftar')
  bad(field('k3', 'v5', 'namaLain', 'display_name'), 'peran ganda dalam satu produk')
  // Satu kartu paling banyak satu jamaah per booking; jamaah tanpa kartu (NULL) tak bentrok.
  const two = `SET session_replication_role = replica; INSERT INTO booking_pilgrims (id, "bookingId") VALUES ('p2', 'b-x'), ('p3', 'b-x'); SET session_replication_role = DEFAULT;`
  assert.equal(exec(r.name, two).code, 0, 'dua jamaah tanpa kartu di booking yang sama')
  assert.equal(exec(r.name, `SET session_replication_role = replica; UPDATE booking_pilgrims SET "savedPilgrimId" = 'c1' WHERE id = 'p2';`).code, 0)
  bad(`SET session_replication_role = replica; UPDATE booking_pilgrims SET "savedPilgrimId" = 'c1' WHERE id = 'p3';`, 'kartu sama dua kali dalam satu booking')
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
