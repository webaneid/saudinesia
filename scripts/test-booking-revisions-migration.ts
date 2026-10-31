// Uji migrasi revisi booking (prisma/migrations/20261109090000_booking_revisions, docs/arsitektur-booking-engine-v2.md §10.4 6b): ADITIF (snapshot lama utuh, belum void),
// trigger beku T1 (UPDATE hanya boleh mengisi kolom void SEKALI; kolom lain/void ulang/void sebagian ditolak), booking_revisions append-only (hanya `reason` dapat
// dibersihkan), CHECK; dan DB hasil SEMUA migrasi = schema.prisma (uji drift TERBARU berada di berkas ini).
//
// PENGAMAN: membuat/menghapus database sementara `<db>_tmp_*` di server yang sama — menolak jalan kecuali DATABASE_URL adalah DB uji.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { assertThrowawayDb } from './lib/testDb'
import { legacyUser } from './lib/legacyUser'

await assertThrowawayDb()

const MIGRATION = '20261109090000_booking_revisions'
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
const tmp = mkdtempSync(join(tmpdir(), 'revisions-mig-'))
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
// Migrasi yang diuji DAN semua yang lebih baru (penguatan pascaaudit: settings_audit + CHECK) — supaya uji drift membandingkan DB hasil SEMUA migrasi.
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
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ...res }
}
const snaps = (name: string, bookingId: string) => query(name, `select "itemType" as t, "lineKey" as k, "itemLabel" as label, "itemDetail" as detail, "itemQty" as iq, "unitCostIdr"::float as cost, "totalSellIdr"::float as sell, mode from price_snapshots where "bookingId" = '${bookingId}' order by "itemType", "lineKey"`)

async function scenarioWith(fixtures: (db: PrismaClient) => Promise<Record<string, string>>) {
  const name = `${mainName}${suffix}_s${++n}`
  await newDb(name, baseName)
  const db = new PrismaClient({ datasourceUrl: dbUrl(name) })
  let ids: Record<string, string>
  try { ids = await fixtures(db) } finally { await db.$disconnect() }
  const res = run(dbUrl(name), ['migrate', 'deploy', '--schema', 'schema.prisma'])
  return { name, ids, ...res }
}

const diff = (name: string) => run(dbUrl(name), ['migrate', 'diff', '--from-url', dbUrl(name), '--to-schema-datamodel', 'schema.prisma', '--exit-code'])
const q1 = async (name: string, sql: string) => (await query(name, sql))


async function seedUser(db: PrismaClient) {
  return legacyUser(db, { email: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() })
}
const one = async (name: string, sql: string) => (await query(name, sql))[0]!
const USER = `INSERT INTO users (id, email, "passwordHash", "fullName", role, "isActive", "updatedAt") VALUES ('d0000000-0000-4000-8000-000000000001', 'lama@example.test', 'x', 'Lama', 'pilgrim', true, now());`
const BOOKING = (code: string, status: string) => `INSERT INTO bookings (id, "bookingCode", "userId", status, season, "totalAmount", "updatedAt") VALUES (gen_random_uuid(), '${code}', 'd0000000-0000-4000-8000-000000000001', '${status}'::booking_status, 'regular', 1000, now());`

console.log('== skenario ==')

const SNAP = `INSERT INTO bookings (id, "bookingCode", "userId", status, season, "totalAmount", "updatedAt") VALUES ('b0000000-0000-4000-8000-000000000001', 'R1', 'd0000000-0000-4000-8000-000000000001', 'active', 'regular', 1000, now());
INSERT INTO price_snapshots (id, "bookingId", "itemType", "itemId", "itemLabel", "itemQty", description, qty, unit, "unitSellIdr", "totalSellIdr", mode) VALUES ('s0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'hotel', 'h1', 'Hotel', 1, 'Hotel', 1, 'item', 1000, 1000, 'auto');`

await t('ADITIF: snapshot lama utuh dan BELUM void; kolom void timestamptz/nullable; tabel booking_revisions ada', async () => {
  const r = await scenario([USER, SNAP].join('\n'))
  assert.equal(r.code, 0, `migrasi harus berhasil:\n${r.out.slice(-500)}`)
  assert.deepEqual(await query(r.name, `select "totalSellIdr"::float as sell, "voidedAt" from price_snapshots`), [{ sell: 1000, voidedAt: null }])
  assert.deepEqual(await query(r.name, `select data_type as d from information_schema.columns where table_name = 'price_snapshots' and column_name = 'voidedAt'`), [{ d: 'timestamp with time zone' }])
  assert.deepEqual(await query(r.name, `select count(*)::int as n from information_schema.tables where table_name = 'booking_revisions'`), [{ n: 1 }])
})

await t('TRIGGER T1: ubah kolom harga ditolak; void SEKALI (4 kolom) boleh; void ulang ditolak; void sambil mengubah harga ditolak; void sebagian (CHECK) ditolak; revisi < 2 ditolak', async () => {
  const r = await scenario([USER, SNAP].join('\n'))
  assert.equal(r.code, 0, r.out.slice(-300))
  const db = new PrismaClient({ datasourceUrl: dbUrl(r.name) })
  const VOID = `"voidedAt" = now(), "voidedById" = 'staf', "voidReason" = 'diganti', "voidRevision" = 2`
  try {
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE price_snapshots SET "itemLabel" = 'X'`), /beku|check/i)
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE price_snapshots SET ${VOID}, "unitSellIdr" = 1, "totalSellIdr" = 1`), /beku|check/i, 'void + ubah harga')
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE price_snapshots SET "voidedAt" = now()`), /check|void_complete/i, 'void sebagian')
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE price_snapshots SET "voidedAt" = now(), "voidedById" = 'staf', "voidReason" = 'x', "voidRevision" = 1`), /check|void_complete/i, 'revisi 1')
    await db.$executeRawUnsafe(`UPDATE price_snapshots SET ${VOID}`)
    assert.deepEqual(await db.$queryRawUnsafe(`select "voidReason" as r, "voidRevision" as v from price_snapshots`), [{ r: 'diganti', v: 2 }])
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE price_snapshots SET "voidReason" = 'lain'`), /beku|check/i, 'void ulang / ubah jejak void')
    await db.$executeRawUnsafe(`DELETE FROM bookings`) // cascade tetap bisa (hapus booking = hanya draf di aplikasi)
  } finally { await db.$disconnect() }
})

await t('booking_revisions APPEND-ONLY: hanya `reason` dapat dibersihkan; ubah total/ringkasan ditolak; jenis/revisi/ringkasan dijaga CHECK; (booking, revisi) unik', async () => {
  const r = await scenario([USER, SNAP].join('\n'))
  assert.equal(r.code, 0, r.out.slice(-300))
  const db = new PrismaClient({ datasourceUrl: dbUrl(r.name) })
  const INS = (rev: number, kind = 'items', summary = `'[]'`) => `INSERT INTO booking_revisions (id, "bookingId", revision, kind, reason, summary, "totalBefore", "totalAfter", "taxBefore", "taxAfter", "byUserId") VALUES (gen_random_uuid(), 'b0000000-0000-4000-8000-000000000001', ${rev}, '${kind}', 'nego Budi', ${summary}, 1000, 900, 0, 0, 'staf')`
  try {
    await db.$executeRawUnsafe(INS(2))
    await db.$executeRawUnsafe(`UPDATE booking_revisions SET reason = '[dihapus]'`)
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE booking_revisions SET "totalAfter" = 1`), /append-only|check/i)
    await assert.rejects(() => db.$executeRawUnsafe(`UPDATE booking_revisions SET summary = '[1]'`), /append-only|check/i)
    await assert.rejects(() => db.$executeRawUnsafe(INS(2)), /unique|duplicate|23505|already exists/i)
    await assert.rejects(() => db.$executeRawUnsafe(INS(1)), /check|23514/i)
    await assert.rejects(() => db.$executeRawUnsafe(INS(3, 'lain')), /check|23514/i)
    await assert.rejects(() => db.$executeRawUnsafe(INS(4, 'items', `'{}'`)), /check|23514/i)
  } finally { await db.$disconnect() }
})

await t('tanpa drift: DB hasil SEMUA migrasi = schema.prisma', async () => {
  const r = await scenarioWith(async () => ({}))
  assert.equal(r.code, 0, r.out.slice(-300))
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
