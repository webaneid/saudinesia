// Penjaga peran database aplikasi (docs/rencana-audit-golive.md §5, SEC-303). Peran web (`appRoleSql`, diterapkan kontainer migrate lewat
// `prisma db execute` — jalur yang SAMA dipakai di sini) hanya boleh DML: tak bisa mematikan trigger append-only/beku, membuat/menghapus tabel,
// TRUNCATE, `COPY … TO PROGRAM`, atau `session_replication_role`; tetapi kunci yang dipakai aplikasi (LOCK TABLE kode booking, advisory) jalan.
// Hanya pada database sekali pakai dan koneksi superuser (CI: postgres); peran uji bernama acak dan dihapus di akhir.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { APP_ROLE, appRoleSql, appRoleStatements } from '../prisma/appRole'

let failed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 6).join('\n     ')}`) }
}

console.log('== bentuk SQL ==')
await t('appRoleSql menolak sandi pendek/bersimbol dan nama peran tak sah', () => {
  assert.throws(() => appRoleSql(APP_ROLE, 'pendek'))
  assert.throws(() => appRoleSql(APP_ROLE, `${'a'.repeat(40)}'; DROP TABLE users; --`))
  assert.throws(() => appRoleSql('x; DROP ROLE postgres', 'a'.repeat(40)))
  const sql = appRoleSql(APP_ROLE, 'a'.repeat(48))
  assert.match(sql, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/)
  assert.doesNotMatch(sql, /GRANT (ALL|.*TRUNCATE)/)
})

await t('compose/Dockerfile: web memegang hanya URL peran aplikasi, migrate menerapkan peran sesudah migrasi', () => {
  const compose = readFileSync('docker-compose.prod.yml', 'utf8')
  const web = compose.slice(compose.indexOf('\n  web:'), compose.indexOf('\n  migrate:'))
  const migrate = compose.slice(compose.indexOf('\n  migrate:'), compose.indexOf('\n  postgres:'))
  for (const k of ['POSTGRES_PASSWORD', 'MIGRATE_DATABASE_URL', 'APP_DB_PASSWORD']) assert.match(web, new RegExp(`${k}: ""`), `web harus mengosongkan ${k}`)
  assert.match(migrate, /DATABASE_URL: \$\{MIGRATE_DATABASE_URL:\?/)
  assert.match(readFileSync('Dockerfile', 'utf8'), /prisma migrate deploy && bun prisma\/apply-app-role\.ts/)
  const env = readFileSync('.env.production.example', 'utf8')
  assert.match(env, /^DATABASE_URL=postgresql:\/\/saudinesia_app:/m)
  assert.match(env, /^MIGRATE_DATABASE_URL=postgresql:\/\/saudinesia:/m)
})

const dbUrl = process.env.DATABASE_URL ?? ''
const owner = new PrismaClient({ datasourceUrl: dbUrl })
const superuser = /test|_ci|tmp/.test(dbUrl.split('/').pop() ?? '')
  && (await owner.$queryRaw<{ s: boolean }[]>`SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`)[0]?.s === true
if (!superuser) {
  console.log('SKIP uji peran sungguhan: bukan database sekali pakai dengan koneksi superuser')
} else {
  const role = `saudinesia_app_t${randomBytes(4).toString('hex')}`
  const password = randomBytes(24).toString('hex')
  // Pernyataan yang sama dengan skrip image migrate (appRoleSql = gabungannya), dijalankan lewat koneksi pemilik: `bunx prisma db execute
  // --stdin` di runner CI Linux melapor sukses tanpa membuat peran, sedangkan jalur image migrate dibuktikan job docker CI.
  const apply = () => owner.$transaction(appRoleStatements(role, password).map((q) => owner.$executeRawUnsafe(q)))
  const u = new URL(dbUrl); u.username = role; u.password = password
  const app = new PrismaClient({ datasourceUrl: u.toString() })
  const refused = async (sql: string) => {
    let err: unknown
    try { await app.$executeRawUnsafe(sql) } catch (e) { err = e }
    assert.ok(err, `seharusnya ditolak: ${sql}`)
    assert.match(String((err as Error).message), /permission denied|must be owner|must be superuser|not allowed|only superuser|privilege/i, sql)
  }
  try {
    await t('peran diterapkan dua kali (idempoten); skrip image migrate = gabungan pernyataan yang sama', async () => {
      await apply(); await apply()
      assert.equal(appRoleSql(role, password), `\n${appRoleStatements(role, password).join(';\n')};\n`)
    })
    await t('peran tersimpan: LOGIN, sandi ber-hash SCRAM', async () => {
      const r = await owner.$queryRawUnsafe<{ login: boolean; kind: string | null; enc: string }[]>(
        `SELECT rolcanlogin AS login, left(rolpassword, 13) AS kind, current_setting('password_encryption') AS enc FROM pg_authid WHERE rolname = '${role}'`)
      assert.deepEqual(r, [{ login: true, kind: 'SCRAM-SHA-256', enc: 'scram-sha-256' }])
    })
    await t('peran aplikasi: bukan superuser, tak bisa membuat db/peran, bukan pemilik tabel', async () => {
      const [r] = await app.$queryRaw<{ u: string; s: boolean; db: boolean; cr: boolean; owned: bigint }[]>`
        SELECT current_user AS u, r.rolsuper AS s, r.rolcreatedb AS db, r.rolcreaterole AS cr,
               (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid) AS owned
        FROM pg_roles r WHERE r.rolname = current_user`
      assert.deepEqual(r, { u: role, s: false, db: false, cr: false, owned: BigInt(0) })
    })
    await t('setiap tabel aplikasi: SELECT/INSERT/UPDATE/DELETE ya, TRUNCATE/TRIGGER tidak; _prisma_migrations tertutup', async () => {
      const rows = await app.$queryRaw<{ t: string; s: boolean; i: boolean; up: boolean; d: boolean; tr: boolean; tg: boolean }[]>`
        SELECT tablename AS t,
          has_table_privilege(quote_ident(tablename), 'SELECT') AS s, has_table_privilege(quote_ident(tablename), 'INSERT') AS i,
          has_table_privilege(quote_ident(tablename), 'UPDATE') AS up, has_table_privilege(quote_ident(tablename), 'DELETE') AS d,
          has_table_privilege(quote_ident(tablename), 'TRUNCATE') AS tr, has_table_privilege(quote_ident(tablename), 'TRIGGER') AS tg
        FROM pg_tables WHERE schemaname = 'public'`
      assert.ok(rows.length > 50, `tabel terlalu sedikit (${rows.length}) — migrasi belum jalan?`)
      const wrong = rows.filter((r) => r.t === '_prisma_migrations' ? (r.s || r.i || r.up || r.d) : !(r.s && r.i && r.up && r.d) || r.tr || r.tg)
      assert.deepEqual(wrong.map((r) => r.t), [])
    })
    await t('tak bisa mematikan trigger append-only/beku, DDL, TRUNCATE, COPY TO PROGRAM, session_replication_role', async () => {
      const triggers = await owner.$queryRaw<{ t: string }[]>`SELECT DISTINCT c.relname AS t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT g.tgisinternal AND n.nspname = 'public'`
      assert.ok(triggers.length >= 5, `trigger beku terlalu sedikit (${triggers.length})`)
      for (const { t: table } of triggers) await refused(`ALTER TABLE "${table}" DISABLE TRIGGER ALL`)
      await refused('ALTER TABLE "cash_entries" DROP COLUMN "amountIdr"')
      await refused('DROP TABLE "cash_entries"')
      await refused('TRUNCATE "price_snapshots"')
      await refused('CREATE TABLE "public"."x_role_probe" (id int)')
      await refused("COPY (SELECT 1) TO PROGRAM 'true'")
      await refused('SET session_replication_role = replica')
      await refused('ALTER ROLE CURRENT_USER SUPERUSER')
      await refused('CREATE ROLE x_role_probe')
    })
    await t('kunci yang dipakai aplikasi tetap jalan (LOCK TABLE kode booking, advisory lock)', async () => {
      await app.$transaction(async (tx) => {
        await tx.$executeRaw`LOCK TABLE "booking_code_lock" IN EXCLUSIVE MODE`
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('uji-peran'))`
      })
    })
    await t('tabel baru buatan pemilik sesudah peran diterapkan ikut terbuka (default privileges)', async () => {
      await owner.$executeRawUnsafe('CREATE TABLE "public"."x_role_default" (id int)')
      try {
        await app.$executeRawUnsafe('INSERT INTO "x_role_default" VALUES (1)')
        assert.equal((await app.$queryRawUnsafe<{ n: bigint }[]>('SELECT count(*) AS n FROM "x_role_default"'))[0]?.n, BigInt(1))
      } finally { await owner.$executeRawUnsafe('DROP TABLE "public"."x_role_default"') }
    })
  } finally {
    await app.$disconnect()
    await owner.$executeRawUnsafe(`DROP OWNED BY ${role}`)
    await owner.$executeRawUnsafe(`DROP ROLE ${role}`)
  }
}
await owner.$disconnect()

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
