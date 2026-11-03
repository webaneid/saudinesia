// Uji migrasi Visa V3 (prisma/migrations/20261118090000_visa_required_components_v3, docs/rencana-visa-produk.md §2.5): jenis aturan `hotel` lama → `hotel_makkah` +
// `hotel_madinah`; aturan tak dikenal → BERHENTI; pelonggaran per pelanggan masih aktif → BERHENTI; kolom `users.allowVisaWithoutBundle` dibuang; atomik; dan
// DB hasil SEMUA migrasi = schema.prisma (uji drift TERBARU kini di berkas ini).
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

const MIGRATION = '20261118090000_visa_required_components_v3'
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
const tmp = mkdtempSync(join(tmpdir(), 'visa-v3-mig-'))
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
// Migrasi yang diuji DAN semua yang lebih baru — supaya uji drift membandingkan DB hasil SEMUA migrasi.
for (const d of readdirSync(join(root, 'prisma/migrations'))) {
  if (d >= MIGRATION && !d.endsWith('.toml')) cpSync(join(root, 'prisma/migrations', d), join(tmp, 'migrations', d), { recursive: true })
}

let n = 0
async function scenario(setup: string) {
  const name = `${mainName}${suffix}_s${++n}`
  await newDb(name, baseName)
  if (setup) {
    const r = exec(name, setup)
    assert.equal(r.code, 0, `setup skenario gagal:\n${r.out.slice(-500)}`)
  }
  return { name, ...run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma']) }
}
const diff = (name: string) => run(dbUrl(name), ['migrate', 'diff', '--from-url', dbUrl(name), '--to-schema-datamodel', 'schema.prisma', '--exit-code'])
const one = async (name: string, sql: string) => (await query(name, sql))[0]!
const colExists = async (name: string, table: string, col: string) => Number((await one(name, `select count(*)::int as n from information_schema.columns where table_name = '${table}' and column_name = '${col}'`)).n) === 1
const rules = async (name: string) => Object.fromEntries((await query(name, `select name, "requiredComponents" as rc from visa_products order by name`)).map(r => [r.name as string, r.rc]))
const VISA = (name: string, rc: string) => `INSERT INTO visa_products (id, name, "visaType", "requiredComponents") VALUES (gen_random_uuid(), '${name}', 'Umroh', '${rc}'::jsonb);`
const USER = (email: string, allow: boolean) => `INSERT INTO users (id, email, "passwordHash", "fullName", role, "isActive", "updatedAt", "allowVisaWithoutBundle") VALUES (gen_random_uuid(), '${email}', 'x', 'Uji', 'pilgrim', true, timezone('UTC', now()), ${allow});`
const types = (v: unknown) => (v as Array<{ type: string }>).map(x => x.type).sort()

console.log('== skenario ==')

await t('hotel lama (kota apa saja) → hotel Makkah + hotel Madinah; komponen lain & filter transport utuh; tanpa hotel tidak disentuh; pelanggan biasa → kolom dibuang', async () => {
  const r = await scenario([
    VISA('V1', '[{"type":"flight"},{"type":"hotel"}]'),
    VISA('V2', '[{"type":"hotel"},{"type":"transport","categories":["airport"]}]'),
    VISA('V3', '[]'),
    VISA('V4', '[{"type":"flight"}]'),
    VISA('V5', '[{"type":"hotel"},{"type":"hotel_makkah"}]'),
    USER('biasa@example.test', false),
  ].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  const rows = await rules(r.name)
  assert.deepEqual(types(rows.V1), ['flight', 'hotel_madinah', 'hotel_makkah'])
  assert.deepEqual(types(rows.V2), ['hotel_madinah', 'hotel_makkah', 'transport'])
  assert.deepEqual((rows.V2 as Array<Record<string, unknown>>).find(x => x.type === 'transport'), { type: 'transport', categories: ['airport'] })
  assert.deepEqual(rows.V3, []); assert.deepEqual(rows.V4, [{ type: 'flight' }])
  assert.deepEqual(types(rows.V5), ['hotel_madinah', 'hotel_makkah'], 'duplikat setelah pemecahan dirapikan')
  assert.equal(await colExists(r.name, 'users', 'allowVisaWithoutBundle'), false)
  assert.equal(Number((await one(r.name, `select count(*)::int as n from users`)).n), 1, 'akun tidak hilang')
})

for (const [label, rc] of [['tipe tak dikenal', '[{"type":"kapal"}]'], ['string lama', '["flight"]'], ['bukan array', '{"type":"hotel"}'], ['null JSON', 'null']] as const) {
  await t(`FAIL-CLOSED + ATOMIK: aturan visa ${label} → migrasi BERHENTI, aturan & kolom pelanggan tak berubah`, async () => {
    const r = await scenario([VISA('VX', rc), VISA('VH', '[{"type":"hotel"}]')].join('\n'))
    assert.notEqual(r.code, 0, 'harus gagal')
    assert.match(r.out, /requiredComponents tak dikenal/)
    const rows = await rules(r.name)
    assert.deepEqual(rows.VX, JSON.parse(rc)); assert.deepEqual(rows.VH, [{ type: 'hotel' }], 'atomik: konversi hotel ikut batal')
    assert.equal(await colExists(r.name, 'users', 'allowVisaWithoutBundle'), true)
  })
}

await t('FAIL-CLOSED + ATOMIK: masih ada pelanggan berpelonggaran aktif → BERHENTI; kolom & aturan visa tetap seperti semula', async () => {
  const r = await scenario([VISA('VH', '[{"type":"hotel"}]'), USER('longgar@example.test', true), USER('biasa@example.test', false)].join('\n'))
  assert.notEqual(r.code, 0, 'harus gagal'); assert.match(r.out, /masih memakai pelonggaran/)
  assert.equal(await colExists(r.name, 'users', 'allowVisaWithoutBundle'), true)
  assert.deepEqual((await rules(r.name)).VH, [{ type: 'hotel' }])
})

await t('tanpa drift: DB hasil SEMUA migrasi = schema.prisma (uji drift TERBARU berada di berkas ini)', async () => {
  const r = await scenario('')
  assert.equal(r.code, 0, r.out.slice(-500))
  const d = diff(r.name)
  assert.equal(d.code, 0, `drift skema:\n${d.out.slice(-800)}`)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────
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
