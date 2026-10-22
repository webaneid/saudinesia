// Uji penjaga seed (SEC-27, prisma/seedGuard.ts). Dua lapis: (1) tabel keputusan fungsi murni, (2) MENJALANKAN `prisma/seed.ts`
// sungguhan sebagai proses terpisah dengan kombinasi lingkungan berbahaya dan membuktikan DB tidak berubah.
//
// PENGAMAN: seed menghapus data katalog → assertThrowawayDb() (host lokal, satu segmen path, nama bertoken test/ci/tmp, current_database()).
// Dijalankan TERAKHIR di rantai `bun run test`: seed meninggalkan data katalog + akun demo di DB uji (sekali pakai).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { isLoopbackDb, seedDataProblem, seedEnvProblem, seedTarget } from '../prisma/seedGuard'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

console.log('== keputusan lingkungan (murni) ==')

await t('hanya NODE_ENV persis "development" + host lokal yang lolos; kontrol positif di tiap penolakan', () => {
  const ok = { nodeEnv: 'development', databaseUrl: 'postgresql://u:p@localhost:5432/saudinesia' }
  assert.equal(seedEnvProblem(ok), null, 'kontrol positif')
  for (const nodeEnv of [undefined, '', 'production', 'test', 'staging', 'Development', 'dev']) assert.match(seedEnvProblem({ ...ok, nodeEnv }) ?? '', /NODE_ENV/, String(nodeEnv))
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(seedEnvProblem({ ...ok, databaseUrl: `postgresql://u:p@${host}:5432/x` }), null, host)
})

await t('host jauh / aneh ditolak: nama compose, domain, IP privat, trik userinfo, URL rusak/kosong', () => {
  const dev = (databaseUrl?: string, allowHost?: string) => seedEnvProblem({ nodeEnv: 'development', databaseUrl, allowHost })
  for (const url of ['postgresql://u:p@postgres:5432/saudinesia', 'postgresql://u:p@db.example.com/x', 'postgresql://u:p@10.0.0.5:5432/x', 'postgresql://localhost@evil.example.com/x', 'postgresql://u:p@localhost.evil.com/x']) {
    assert.match(dev(url) ?? '', /bukan mesin lokal/, url)
  }
  for (const url of [undefined, '', 'bukan url']) assert.match(dev(url) ?? '', /DATABASE_URL/, String(url))
})

await t('SEED_ALLOW_HOST hanya meloloskan host yang PERSIS sama', () => {
  const url = 'postgresql://u:p@devbox.internal:5432/x'
  const pw = 'x'.repeat(16) // host non-loopback wajib password eksplisit (S26-T06) — diberikan agar yang diuji murni pencocokan host
  assert.equal(seedEnvProblem({ nodeEnv: 'development', databaseUrl: url, allowHost: 'devbox.internal', superadminPassword: pw }), null)
  assert.match(seedEnvProblem({ nodeEnv: 'development', databaseUrl: url, allowHost: 'devbox', superadminPassword: pw }) ?? '', /bukan mesin lokal/)
  assert.match(seedEnvProblem({ nodeEnv: 'production', databaseUrl: url, allowHost: 'devbox.internal', superadminPassword: pw }) ?? '', /NODE_ENV/, 'allow-host tak melewati NODE_ENV')
})

await t('S26-T03: parameter ?host= / ?hostaddr= MENIMPA host koneksi → ditolak walau hostname-nya localhost (diverifikasi: Prisma menyambung ke host itu)', () => {
  const dev = (databaseUrl: string) => seedEnvProblem({ nodeEnv: 'development', databaseUrl })
  assert.equal(dev('postgresql://u:p@localhost:5432/x?schema=public'), null, 'kontrol: parameter lain yang wajar tetap lolos')
  for (const q of ['host=db.prod.example', 'HOST=db.prod.example', 'hostaddr=203.0.113.9', 'schema=public&host=/var/run/postgresql']) {
    assert.match(dev(`postgresql://u:p@localhost:5432/x?${q}`) ?? '', /menimpa host koneksi/, q)
  }
})

await t('S26-T05: SEED_ALLOW_HOST kosong dianggap tidak diset (tak cocok dengan hostname kosong); target dicetak tanpa kredensial', () => {
  for (const url of ['postgresql://u:p@/db', 'postgresql://u:p@/db?foo=bar']) assert.notEqual(seedEnvProblem({ nodeEnv: 'development', databaseUrl: url, allowHost: '', superadminPassword: 'x'.repeat(16) }), null, url)
  assert.match(seedEnvProblem({ nodeEnv: 'development', databaseUrl: 'postgresql://u:p@db.example.com/x', allowHost: '' }) ?? '', /bukan mesin lokal/, 'allow-host kosong tak meloloskan host mana pun')
  assert.equal(seedTarget('postgresql://user:rahasia@localhost:5432/saudinesia'), 'host=localhost db=saudinesia')
  assert.doesNotMatch(seedTarget('postgresql://user:rahasia@localhost:5432/saudinesia'), /rahasia|user/)
})

await t('S26-T06: host non-loopback (lewat SEED_ALLOW_HOST) WAJIB SUPERADMIN_PASSWORD; loopback tidak; isLoopbackDb membedakan keduanya', () => {
  const url = 'postgresql://u:p@devbox.internal:5432/x'
  assert.match(seedEnvProblem({ nodeEnv: 'development', databaseUrl: url, allowHost: 'devbox.internal' }) ?? '', /SUPERADMIN_PASSWORD/)
  assert.equal(seedEnvProblem({ nodeEnv: 'development', databaseUrl: url, allowHost: 'devbox.internal', superadminPassword: 'x'.repeat(16) }), null)
  assert.equal(seedEnvProblem({ nodeEnv: 'development', databaseUrl: 'postgresql://u:p@localhost/x' }), null, 'loopback tanpa password eksplisit tetap boleh (dev)')
  assert.equal(isLoopbackDb('postgresql://u:p@localhost/x'), true); assert.equal(isLoopbackDb(url), false); assert.equal(isLoopbackDb('bukan url'), false)
})

console.log('== menjalankan seed sungguhan ==')

const pilgrims = await prisma.user.count({ where: { role: 'pilgrim' } })
const bookings = await prisma.booking.count()
assert.ok(pilgrims === 0 && bookings === 0, `DB uji tidak bersih (${pilgrims} jamaah, ${bookings} booking) — uji ini butuh DB kosong dari data jamaah`)

function runSeed(extra: Record<string, string | undefined>) {
  const env: Record<string, string | undefined> = { ...process.env, ...extra }
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]
  const r = spawnSync(process.execPath, ['prisma/seed.ts'], { env: env as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 120_000 })
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` }
}
const dbUrl = process.env.DATABASE_URL!
const snapshot = async () => ({ users: await prisma.user.count(), seasons: await prisma.season.count(), hotels: await prisma.hotel.count() })

await t('NODE_ENV=production / tidak diset → ditolak (exit 2), DB TIDAK berubah sama sekali', async () => {
  const before = await snapshot()
  for (const nodeEnv of ['production', undefined]) {
    const r = runSeed({ NODE_ENV: nodeEnv, DATABASE_URL: dbUrl })
    assert.equal(r.code, 2, `${nodeEnv}: ${r.out.slice(0, 300)}`); assert.match(r.out, /Seed DITOLAK: NODE_ENV/)
  }
  assert.deepEqual(await snapshot(), before)
})

await t('host database bukan lokal → ditolak SEBELUM menyambung (exit 2)', async () => {
  const remote = dbUrl.replace(/@[^/]+\//, '@db.example.invalid:5432/')
  assert.notEqual(remote, dbUrl, 'penggantian host gagal — uji tak bermakna')
  const r = runSeed({ NODE_ENV: 'development', DATABASE_URL: remote })
  assert.equal(r.code, 2, r.out.slice(0, 300)); assert.match(r.out, /bukan mesin lokal/)
})

await t('development + host lokal + DB tanpa data jamaah → seed berjalan; akun demo dibuat (kontrol positif penjaga tidak berlebihan)', async () => {
  const r = runSeed({ NODE_ENV: 'development', DATABASE_URL: dbUrl })
  assert.equal(r.code, 0, r.out.slice(-600))
  const users = await prisma.user.findMany({ where: { email: { in: ['admin@saudinesia.local', 'manager@saudinesia.local', 'ops@saudinesia.local'] } }, select: { email: true, role: true, passwordHash: true } })
  assert.deepEqual(users.map((u) => u.role).sort(), ['admin', 'manager', 'superadmin'])
  for (const u of users) assert.equal(await compare('Admin@1234', u.passwordHash), true, `${u.email} memakai kredensial dev terdokumentasi`)
  assert.ok((await prisma.season.count()) >= 3)
})

await t('seed ulang idempoten; menimpa akun demo MENAIKKAN sessionVersion (sesi lama dicabut)', async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@saudinesia.local' }, select: { sessionVersion: true } })
  const r = runSeed({ NODE_ENV: 'development', DATABASE_URL: dbUrl })
  assert.equal(r.code, 0, r.out.slice(-400))
  const after = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@saudinesia.local' }, select: { sessionVersion: true } })
  assert.equal(after.sessionVersion, before.sessionVersion + 1)
})

await t('S26-T04: akun non-demo (bukan *.local) menolak seed — menutup jendela pra-go-live (belum ada jamaah/booking, tapi superadmin nyata ada)', async () => {
  const real = await prisma.user.create({ data: { email: `superadmin-nyata-${Date.now()}@example.test`, passwordHash: 'x', fullName: 'Superadmin Nyata', role: 'superadmin', isActive: true, emailVerifiedAt: new Date() } })
  try {
    const before = await snapshot()
    const r = runSeed({ NODE_ENV: 'development', DATABASE_URL: dbUrl })
    assert.equal(r.code, 2, r.out.slice(-400)); assert.match(r.out, /1 akun non-demo/)
    assert.deepEqual(await snapshot(), before)
  } finally {
    await prisma.user.delete({ where: { id: real.id } })
  }
  assert.equal(runSeed({ NODE_ENV: 'development', DATABASE_URL: dbUrl }).code, 0, 'kontrol positif: tanpa akun non-demo seed berjalan lagi')
})

await t('DB berisi jamaah → seed ditolak dan TIDAK menyentuh apa pun; SEED_FORCE=1 melewatinya', async () => {
  const pilgrim = await prisma.user.create({ data: { email: `seedguard-${Date.now()}@example.test`, passwordHash: 'x', fullName: 'Jamaah Nyata', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
  try {
    const before = await snapshot()
    const sv = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@saudinesia.local' }, select: { sessionVersion: true } })).sessionVersion
    const r = runSeed({ NODE_ENV: 'development', DATABASE_URL: dbUrl })
    assert.equal(r.code, 2, r.out.slice(-400)); assert.match(r.out, /berisi 1 jamaah/)
    assert.deepEqual(await snapshot(), before)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: 'admin@saudinesia.local' }, select: { sessionVersion: true } })).sessionVersion, sv, 'akun demo tak boleh disentuh')
    assert.equal(await seedDataProblem(prisma, true), null, 'kontrol: force melewati')
    const forced = runSeed({ NODE_ENV: 'development', DATABASE_URL: dbUrl, SEED_FORCE: '1' })
    assert.equal(forced.code, 0, forced.out.slice(-400))
  } finally {
    await prisma.user.delete({ where: { id: pilgrim.id } })
  }
})

console.log('== penjaga sumber ==')

await t('skrip db:seed / prisma.seed menetapkan NODE_ENV=development; seed.ts memeriksa penjaga sebelum menyentuh DB; image runner tak menyalin seed', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string>; prisma: { seed: string } }
  assert.match(pkg.scripts['db:seed'] ?? '', /^NODE_ENV=development bun prisma\/seed\.ts$/); assert.match(pkg.prisma.seed, /^NODE_ENV=development /, '`prisma db seed` memakai kunci prisma.seed')
  const seed = readFileSync('prisma/seed.ts', 'utf8')
  const main = seed.slice(seed.indexOf('async function main()'))
  assert.ok(main.indexOf('seedEnvProblem(') > 0 && main.indexOf('seedEnvProblem(') < main.indexOf('prisma.'), 'penjaga lingkungan harus sebelum akses DB pertama')
  assert.ok(main.indexOf('seedDataProblem(') < main.indexOf('deleteMany'), 'penjaga data harus sebelum penghapusan pertama')
  const docker = readFileSync('Dockerfile', 'utf8')
  const runner = docker.slice(docker.indexOf('AS runner'))
  assert.doesNotMatch(runner, /seed/i, 'image runner tidak boleh menyalin seed')
})

await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
