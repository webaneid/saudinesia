// Migrasi `database_timezone_utc` (docs/arsitektur-booking-engine-v2.md §5.5) pada database sekali pakai: dari zona non-UTC → UTC untuk koneksi BARU; idempoten;
// checkDatabaseTimezone() melaporkan keadaan sebenarnya dan memperingatkan hanya bila bukan UTC.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { checkDatabaseTimezone } from '@/lib/time/dbZone'

await assertThrowawayDb()
let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const sql = readFileSync(join(root, 'prisma/migrations/20261103090000_database_timezone_utc/migration.sql'), 'utf8')
const freshZone = async (): Promise<string> => {
  const c = new PrismaClient() // koneksi BARU (zona database dibaca saat sesi dibuka)
  try { return (await c.$queryRaw<{ TimeZone: string }[]>`SHOW timezone`)[0]!.TimeZone } finally { await c.$disconnect() }
}
const stmts = sql.split(/;\s*\n/).map(x => x.trim()).filter(x => x && !x.split('\n').every(l => l.startsWith('--')))

await t('dari zona non-UTC (Asia/Jakarta) → migrasi → koneksi baru berzona UTC; dijalankan dua kali tetap UTC (idempoten)', async () => {
  await prisma.$executeRawUnsafe(`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO ''Asia/Jakarta''', current_database()); END $$`)
  assert.equal(await freshZone(), 'Asia/Jakarta', 'prasyarat: zona database sengaja non-UTC')
  await prisma.$executeRawUnsafe(sql.replace(/^--.*$/gm, '').trim())
  assert.equal(await freshZone(), 'UTC')
  await prisma.$executeRawUnsafe(sql.replace(/^--.*$/gm, '').trim())
  assert.equal(await freshZone(), 'UTC')
  assert.ok(stmts.length >= 1)
})

await t('checkDatabaseTimezone (klien disuntik): UTC/Etc/UTC → ok tanpa log; Asia/Jakarta → ok=false + peringatan; galat → ok=false tanpa melempar; koneksi sungguhan baru → ok', async () => {
  const fake = (zone: string | Error) => ({ $queryRaw: (async () => { if (zone instanceof Error) throw zone; return [{ TimeZone: zone }] }) as unknown as typeof prisma.$queryRaw })
  const logs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(' ')) }
  try {
    assert.deepEqual(await checkDatabaseTimezone(fake('UTC')), { ok: true, zone: 'UTC' })
    assert.deepEqual(await checkDatabaseTimezone(fake('Etc/UTC')), { ok: true, zone: 'Etc/UTC' })
    assert.equal(logs.length, 0)
    assert.deepEqual(await checkDatabaseTimezone(fake('Asia/Jakarta')), { ok: false, zone: 'Asia/Jakarta' })
    assert.ok(logs.some(l => l.includes('bukan UTC') && l.includes('Asia/Jakarta')))
    assert.equal((await checkDatabaseTimezone(fake(new Error('putus')))).ok, false)
    const c = new PrismaClient()
    try { assert.deepEqual(await checkDatabaseTimezone(c), { ok: true, zone: 'UTC' }) } finally { await c.$disconnect() }
  } finally { console.error = orig }
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
