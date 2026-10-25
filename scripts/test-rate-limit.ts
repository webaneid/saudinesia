// Uji lib/auth/rateLimit.ts (SEC-04). Tanpa framework uji: skrip Bun biasa, keluar non-nol bila ada yang gagal.
//   bun scripts/test-rate-limit.ts                       → memori + "Redis mati"
//   REDIS_TEST_URL=redis://localhost:6379 bun scripts/test-rate-limit.ts   → + Redis sungguhan (CI)
// Jalur Redis diperiksa lewat klien TERPISAH yang membaca kunci langsung — supaya fallback ke memori yang diam-diam
// tidak dianggap lolos.
import assert from 'node:assert/strict'
import { Redis } from 'ioredis'
import { LIMITS, __resetForTests, accountKey, clientIp, consume, peek, policy, reset, resetAccountLimits, tooManyRequests, type Policy } from '@/lib/auth/rateLimit'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 4).join('\n     ')}`)
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const P = (key: string, limit: number, windowSec: number): Policy => ({ key: `test:${key}:${Date.now()}:${Math.random()}`, limit, windowSec })
const env = process.env as Record<string, string | undefined>

// ───────────────────────── 1. memori (tanpa REDIS_URL) ─────────────────────────
delete env.REDIS_URL
env.NODE_ENV = 'test'
delete env.RATE_LIMIT_DISABLED
__resetForTests()
console.log('== memori ==')

await t('mengizinkan sampai batas lalu menolak, dengan retryAfter', async () => {
  const p = P('basic', 3, 60)
  for (let i = 1; i <= 3; i++) assert.equal((await consume(p)).allowed, true, `hit ${i}`)
  const blocked = await consume(p)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.count, 4)
  assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60, `retryAfter=${blocked.retryAfterSec}`)
})

await t('peek tidak menambah hitungan; memblokir setelah batas tercapai', async () => {
  const p = P('peek', 2, 60)
  assert.deepEqual(await peek(p), { allowed: true, count: 0, limit: 2, retryAfterSec: 0 })
  await consume(p)
  assert.equal((await peek(p)).count, 1)
  assert.equal((await peek(p)).count, 1, 'peek kedua tidak boleh menambah')
  assert.equal((await peek(p)).allowed, true)
  await consume(p)
  assert.equal((await peek(p)).allowed, false, 'count 2 dari limit 2 → diblokir')
})

await t('jendela berakhir lalu hitungan mulai lagi dari 1', async () => {
  const p = P('expiry', 1, 1)
  await consume(p)
  assert.equal((await consume(p)).allowed, false)
  await sleep(1150)
  const again = await consume(p)
  assert.equal(again.allowed, true)
  assert.equal(again.count, 1)
})

await t('kunci berbeda saling independen', async () => {
  const a = P('a', 1, 60), b = P('b', 1, 60)
  await consume(a)
  assert.equal((await consume(a)).allowed, false)
  assert.equal((await consume(b)).allowed, true)
})

await t('reset menghapus hitungan', async () => {
  const p = P('reset', 1, 60)
  await consume(p); await consume(p)
  assert.equal((await consume(p)).allowed, false)
  await reset(p)
  assert.equal((await consume(p)).count, 1)
})

await t('50 permintaan paralel dengan batas 10 → tepat 10 diizinkan', async () => {
  const p = P('parallel', 10, 60)
  const hits = await Promise.all(Array.from({ length: 50 }, () => consume(p)))
  assert.equal(hits.filter((h) => h.allowed).length, 10)
})

await t('policy() memakai angka dari LIMITS dan kunci berprefiks', () => {
  const p = policy('loginAcctIp', 'a@b.test|1.2.3.4')
  assert.equal(p.limit, LIMITS.loginAcctIp.limit)
  assert.equal(p.windowSec, LIMITS.loginAcctIp.windowSec)
  assert.equal(p.key, 'rl:loginAcctIp:a@b.test|1.2.3.4')
})

await t('identitas sangat panjang di-hash (kunci tidak bisa digelembungkan), pendek dibiarkan, hash deterministik', () => {
  const long = 'a'.repeat(5000) + '@example.test'
  const a = policy('loginAcct', long), b = policy('loginAcct', long)
  assert.equal(a.key, b.key)
  assert.ok(a.key.length < 100, `panjang kunci ${a.key.length}`)
  assert.match(a.key, /^rl:loginAcct:sha256:[0-9a-f]{64}$/)
  assert.notEqual(policy('loginAcct', long + 'x').key, a.key, 'identitas berbeda → kunci berbeda')
  assert.equal(policy('loginAcct', 'a@b.test').key, 'rl:loginAcct:a@b.test')
  assert.equal(policy('loginAcct', 'x'.repeat(128)).key, 'rl:loginAcct:' + 'x'.repeat(128), 'tepat 128 tidak di-hash')
})

await t('LIMITS: email auth per alamat = 3 per 10 menit (docs/arsitektur-auth.md §3.6)', () => {
  assert.equal(LIMITS.authEmailSendEmail.limit, 3)
  assert.equal(LIMITS.authEmailSendEmail.windowSec, 600)
})

await t('clientIp: ambil IP pertama, tolak nilai yang bukan IP', () => {
  const ip = (h?: string) => clientIp(new Request('http://x', { headers: h === undefined ? {} : { 'x-forwarded-for': h } }))
  assert.equal(ip('203.0.113.7'), '203.0.113.7')
  assert.equal(ip('203.0.113.7, 10.0.0.1'), '203.0.113.7')
  assert.equal(ip('2001:db8::1'), '2001:db8:0:0::/64')
  // IPv6: semua alamat dalam satu /64 memakai kunci yang sama (tak bisa diputar dengan mengganti alamat); /64 lain terpisah
  assert.equal(ip('2001:db8:aaaa:bbbb:1:2:3:4'), ip('2001:db8:AAAA:bbbb:ffff:ffff:ffff:ffff'))
  assert.notEqual(ip('2001:db8:aaaa:bbbb::1'), ip('2001:db8:aaaa:bbbc::1'))
  assert.equal(ip('::1'), '0:0:0:0::/64')
  assert.equal(ip('::ffff:203.0.113.7'), '::ffff:203.0.113.7')
  assert.equal(ip(), null)
  assert.equal(ip(''), null)
  assert.equal(ip('<script>alert(1)</script>'), null)
  assert.equal(ip('a'.repeat(100)), null)
  assert.equal(ip('abc def'), null)
})

await t('bypass dev HANYA bila NODE_ENV=development DAN RATE_LIMIT_DISABLED=true', async () => {
  const run = async (nodeEnv: string | undefined, flag: string | undefined) => {
    if (nodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = nodeEnv
    if (flag === undefined) delete env.RATE_LIMIT_DISABLED; else env.RATE_LIMIT_DISABLED = flag
    const p = P('bypass', 1, 60)
    await consume(p)
    return (await consume(p)).allowed
  }
  assert.equal(await run('development', 'true'), true, 'dev + flag → dilewati')
  assert.equal(await run('development', undefined), false, 'dev tanpa flag → tetap dibatasi')
  assert.equal(await run('production', 'true'), false, 'production + flag → flag diabaikan')
  assert.equal(await run('test', 'true'), false, 'test + flag → flag diabaikan')
  assert.equal(await run('staging', 'true'), false, 'staging + flag → flag diabaikan')
  assert.equal(await run(undefined, 'true'), false, 'NODE_ENV kosong + flag → flag diabaikan')
  env.NODE_ENV = 'test'; delete env.RATE_LIMIT_DISABLED
})

await t('tooManyRequests: 429, Retry-After, pesan dalam menit (dibulatkan ke atas)', async () => {
  const r = tooManyRequests(90)
  assert.equal(r.status, 429)
  assert.equal(r.headers.get('Retry-After'), '90')
  const j = await r.json()
  assert.equal(j.success, false)
  assert.match(j.error, /2 menit/)
  assert.match((await tooManyRequests(5).json()).error, /1 menit/)
})

// ───────────────────────── 2. Redis tidak terjangkau ─────────────────────────
console.log('== Redis mati (port tertutup) ==')
env.REDIS_URL = 'redis://127.0.0.1:1'
__resetForTests()

await t('tetap membatasi lewat memori, panggilan pertama tidak menggantung', async () => {
  const p = P('down', 2, 60)
  const t0 = Date.now()
  assert.equal((await consume(p)).allowed, true)
  const first = Date.now() - t0
  assert.ok(first < 2000, `panggilan pertama ${first}ms`)
  assert.equal((await consume(p)).allowed, true)
  assert.equal((await consume(p)).allowed, false, 'batas 2 harus tetap berlaku tanpa Redis')
})

await t('circuit breaker: panggilan berikutnya cepat (tidak menunggu timeout Redis lagi)', async () => {
  const t0 = Date.now()
  for (let i = 0; i < 20; i++) await consume(P('down-fast', 100, 60))
  const total = Date.now() - t0
  assert.ok(total < 300, `20 panggilan butuh ${total}ms`)
})


// SEC-14 — tombol "buka pembatasan" superadmin. Dijalankan di mode memori DAN Redis (fungsi yang sama, kunci nyata dari `policy`).
async function accountResetScenarios(mode: string) {
  await t(`[${mode}] resetAccountLimits membuka login (akun + akun|IP mana pun) dan email auth satu akun; akun lain dan batas per-IP tak tersentuh`, async () => {
    const victim = `korban-${Date.now()}-${Math.random()}@example.test`, other = `lain-${Date.now()}-${Math.random()}@example.test`
    const keys = (email: string) => ({
      acct: policy('loginAcct', accountKey(email)),
      ip1: policy('loginAcctIp', `${accountKey(email)}|198.51.100.1`),
      ip2: policy('loginAcctIp', `${accountKey(email)}|2001:db8::7`),
      mail: policy('authEmailSendEmail', email),
    })
    const v = keys(victim), o = keys(other), ipOnly = policy('loginIp', '198.51.100.1')
    for (const p of [...Object.values(v), ...Object.values(o), ipOnly]) { await consume(p); await consume(p) }
    assert.equal(await resetAccountLimits(victim), 4, 'tepat 4 kunci milik korban dihapus')
    for (const p of Object.values(v)) assert.equal((await peek(p)).count, 0, `${p.key} harus bersih`)
    for (const p of [...Object.values(o), ipOnly]) assert.equal((await peek(p)).count, 2, `${p.key} tidak boleh tersentuh`)
    assert.equal(await resetAccountLimits(victim), 0, 'kedua kali tidak ada yang tersisa')
  })

  await t(`[${mode}] korban benar-benar bisa login lagi: batas penuh lalu dibuka → permintaan berikut diizinkan`, async () => {
    const email = `penuh-${Date.now()}@example.test`
    const p = policy('loginAcct', accountKey(email))
    for (let i = 0; i < LIMITS.loginAcct.limit; i++) await consume(p)
    assert.equal((await consume(p)).allowed, false, 'terkunci')
    await resetAccountLimits(email)
    assert.equal((await consume(p)).allowed, true, 'terbuka setelah reset')
  })

  await t(`[${mode}] email panjang (di-hash) dan karakter glob di email tetap bisa dibuka; email berawalan sama tidak ikut terhapus`, async () => {
    const long = `${'a'.repeat(90)}-${Date.now()}@example.test`
    const lp = policy('loginAcctIp', `${accountKey(long)}|203.0.113.9`)
    await consume(lp)
    assert.equal(await resetAccountLimits(long), 1)
    assert.equal((await peek(lp)).count, 0)
    const glob = `a*b?c[d]-${Date.now()}@example.test`, decoy = `aXXbYc-${Date.now()}@example.test`
    const gp = policy('loginAcctIp', `${accountKey(glob)}|203.0.113.9`), dp = policy('loginAcctIp', `${accountKey(decoy)}|203.0.113.9`)
    await consume(gp); await consume(dp)
    await resetAccountLimits(glob)
    assert.equal((await peek(gp)).count, 0); assert.equal((await peek(dp)).count, 1, 'karakter glob tak boleh menghapus akun lain')
    const prefixA = `ab-${Date.now()}@example.test`, prefixB = `${prefixA}.id`
    const pa = policy('loginAcctIp', `${accountKey(prefixA)}|203.0.113.9`), pb = policy('loginAcctIp', `${accountKey(prefixB)}|203.0.113.9`)
    await consume(pa); await consume(pb)
    await resetAccountLimits(prefixA)
    assert.equal((await peek(pa)).count, 0); assert.equal((await peek(pb)).count, 1, 'awalan sama bukan akun yang sama')
  })
}

console.log('== SEC-14: buka pembatasan akun (memori) ==')
__resetForTests()
await accountResetScenarios('memori')

// ───────────────────────── 3. Redis sungguhan ─────────────────────────
const redisUrl = env.REDIS_TEST_URL
if (!redisUrl) {
  console.log('== Redis sungguhan: DILEWATI (REDIS_TEST_URL kosong) — dijalankan di CI ==')
} else {
  console.log('== Redis sungguhan ==')
  env.REDIS_URL = redisUrl
  __resetForTests()
  const probe = new Redis(redisUrl)
  await probe.ping()

  await t('hitungan benar-benar ada di Redis (bukan fallback memori) dengan TTL', async () => {
    const p = P('r-key', 5, 60)
    await consume(p)
    assert.equal(await probe.get(p.key), '1', 'kunci harus ada di Redis')
    const ttl = await probe.ttl(p.key)
    assert.ok(ttl > 0 && ttl <= 60, `ttl=${ttl}`)
    await consume(p)
    assert.equal(await probe.get(p.key), '2')
  })

  await t('batas ditegakkan lewat Redis', async () => {
    const p = P('r-limit', 3, 60)
    for (let i = 1; i <= 3; i++) assert.equal((await consume(p)).allowed, true)
    const b = await consume(p)
    assert.equal(b.allowed, false)
    assert.ok(b.retryAfterSec >= 1 && b.retryAfterSec <= 60)
    assert.equal(await probe.get(p.key), '4')
  })

  await t('50 permintaan paralel dengan batas 10 → tepat 10 diizinkan (Lua atomik)', async () => {
    const p = P('r-par', 10, 60)
    const hits = await Promise.all(Array.from({ length: 50 }, () => consume(p)))
    assert.equal(hits.filter((h) => h.allowed).length, 10)
    assert.equal(await probe.get(p.key), '50')
  })

  await t('peek membaca Redis tanpa menambah; reset menghapus kunci', async () => {
    const p = P('r-peek', 2, 60)
    await consume(p)
    assert.equal((await peek(p)).count, 1)
    assert.equal(await probe.get(p.key), '1', 'peek tidak boleh menambah')
    await consume(p)
    assert.equal((await peek(p)).allowed, false)
    await reset(p)
    assert.equal(await probe.get(p.key), null)
  })

  await t('jendela berakhir di Redis lalu mulai lagi', async () => {
    const p = P('r-exp', 1, 1)
    await consume(p)
    assert.equal((await consume(p)).allowed, false)
    await sleep(1200)
    const again = await consume(p)
    assert.equal(again.allowed, true)
    assert.equal(again.count, 1)
  })

  await t('kunci tanpa expiry disembuhkan (tidak boleh menahan pengguna selamanya)', async () => {
    const p = P('r-heal', 5, 60)
    await probe.set(p.key, '5') // tanpa TTL
    assert.equal(await probe.ttl(p.key), -1)
    const h = await consume(p)
    assert.equal(h.count, 6)
    assert.equal(h.allowed, false)
    const ttl = await probe.ttl(p.key)
    assert.ok(ttl > 0 && ttl <= 60, `ttl setelah penyembuhan=${ttl}`)
  })

  console.log('== SEC-14: buka pembatasan akun (Redis) ==')
  await accountResetScenarios('redis')
  await t('[redis] kunci benar-benar terhapus dari Redis (bukan hanya dianggap bersih oleh peek)', async () => {
    const email = `redis-${Date.now()}@example.test`
    const ps = [policy('loginAcct', accountKey(email)), policy('loginAcctIp', `${accountKey(email)}|198.51.100.5`), policy('authEmailSendEmail', email)]
    for (const p of ps) await consume(p)
    for (const p of ps) assert.equal(await probe.get(p.key), '1')
    await resetAccountLimits(email)
    for (const p of ps) assert.equal(await probe.get(p.key), null, `${p.key} masih ada di Redis`)
  })

  await probe.quit()
}

__resetForTests()
console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
