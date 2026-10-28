// Tes karakterisasi routing locale + gerbang kasar auth di middleware.ts (docs/rencana-next-intl-4.md, langkah 0).
// Dibuat SEBELUM upgrade next-intl 4 dan harus hijau di v3 maupun v4: yang dikunci adalah SIFAT yang harus tetap benar (tidak pernah
// mengalihkan ke host lain, prefiks locale, rute terlindungi tetap terlindungi, matcher tidak melepas rute terlindungi), BUKAN detail
// implementasi (v3 membalas rewrite, v4 meneruskan — keduanya 200 dan tidak dibedakan di sini).
//
// Tanpa database/Redis: hanya memanggil `middleware()` langsung dengan NextRequest.
import assert from 'node:assert/strict'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { config, middleware } from '../middleware'
import { canonicalGatePath } from '../lib/auth/gatePath'
import { routing } from '../i18n/routing'

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

const ORIGIN = 'http://localhost:3000'
const env = process.env as Record<string, string | undefined>
env.JWT_SECRET = 'a'.repeat(8) + 'b'.repeat(8) + 'c'.repeat(8) + 'd'.repeat(8) + 'e1f2g3h4' // hanya dibaca middleware untuk memverifikasi cookie uji

const call = (path: string, cookie?: string) =>
  middleware(new NextRequest(ORIGIN + path, cookie ? { headers: { cookie: `snd-session=${cookie}` } } : undefined))

type Outcome = { status: number; redirect: URL | null; rewrite: URL | null; setCookie: string }
async function run(path: string, cookie?: string, headers?: Record<string, string>): Promise<Outcome> {
  const res = await middleware(new NextRequest(ORIGIN + path, { headers: { ...(cookie ? { cookie: `snd-session=${cookie}` } : {}), ...headers } }))
  const loc = res.headers.get('location'); const rw = res.headers.get('x-middleware-rewrite')
  return { status: res.status, redirect: loc ? new URL(loc, ORIGIN) : null, rewrite: rw ? new URL(rw, ORIGIN) : null, setCookie: res.headers.get('set-cookie') ?? '' }
}
const token = (role: string) =>
  new SignJWT({ userId: 'u', role, ver: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET))

console.log('== routing locale ==')

await t('`/` → /id; tanpa prefiks → diprefiks /id; locale dikenal (id, en) tidak dialihkan', async () => {
  const root = await run('/'); assert.equal(root.status, 307); assert.equal(root.redirect?.pathname, '/id')
  const bare = await run('/hotels'); assert.equal(bare.status, 307); assert.equal(bare.redirect?.pathname, '/id/hotels')
  for (const p of ['/id', '/en', '/id/hotels', '/en/hotels', '/id/login']) { const r = await run(p); assert.equal(r.status, 200, p); assert.equal(r.redirect, null, p) }
})

await t('locale tak dikenal (/xx/...) diperlakukan sebagai path biasa di bawah locale default — bukan 500', async () => {
  const r = await run('/xx/hotels'); assert.equal(r.status, 307); assert.ok(r.redirect?.pathname.startsWith('/id/'), r.redirect?.pathname)
})

console.log('== tidak pernah mengalihkan ke host lain (CVE-2026-40299 kelas open redirect) ==')

const HOSTILE = [
  '//evil.com', '//evil.com/', '/\\evil.com', '/%2F%2Fevil.com', '/%5Cevil.com', '/id//evil.com', '//id/evil.com',
  '/%09/evil.com', '/id/%2F%2Fevil.com', '/en/..//evil.com', '/https://evil.com', '/id@evil.com', '/%0d%0a/evil.com', '/id/%0a//evil.com',
]
await t(`${HOSTILE.length} jalur bermusuhan: bila dialihkan, SELALU ke origin yang sama dan bukan scheme-relative (kontrol positif: jalur sah dialihkan di origin yang sama)`, async () => {
  assert.equal((await run('/hotels')).redirect?.origin, ORIGIN, 'kontrol positif')
  for (const p of HOSTILE) {
    const r = await run(p)
    // rewrite juga diperiksa: ia bukan redirect, tetapi menentukan halaman yang dirender (NI-04: dulu hanya redirect yang dicek)
    for (const u of [r.redirect, r.rewrite]) {
      if (!u) continue
      assert.equal(u.origin, ORIGIN, `${p} → ${u.href}`)
      assert.ok(!u.pathname.startsWith('//'), `${p} → path scheme-relative ${u.pathname}`)
    }
  }
})

console.log('== gerbang auth kasar ==')

await t('rute jamaah tanpa cookie → login jamaah; /admin tanpa cookie → login admin; /admin/login publik; rute publik & /api dilewati', async () => {
  for (const p of ['/id/dashboard', '/id/bookings/checkout/visa', '/id/bookings', '/id/profile', '/id/lengkapi-data', '/en/dashboard']) {
    const r = await run(p); assert.equal(r.status, 307, p); assert.equal(r.redirect?.pathname, `/${p.split('/')[1]}/login`, p)
  }
  for (const p of ['/id/admin', '/id/admin/bookings', '/en/admin/system/users']) {
    const r = await run(p); assert.equal(r.status, 307, p); assert.equal(r.redirect?.pathname, `/${p.split('/')[1]}/admin/login`, p)
  }
  assert.equal((await run('/id/admin/login')).redirect, null, 'login admin harus publik')
  assert.equal((await run('/id/hotels')).redirect, null); assert.equal((await run('/api/v1/health')).redirect, null)
})

await t('cookie sesi: jamaah ke /admin → dashboard; admin ke /admin lolos; jamaah ke /dashboard lolos; token sampah = tanpa cookie', async () => {
  const pilgrim = await token('pilgrim'), admin = await token('admin')
  assert.equal((await run('/id/admin', pilgrim)).redirect?.pathname, '/id/dashboard')
  assert.equal((await run('/id/admin', admin)).redirect, null, 'admin lolos gerbang kasar')
  assert.equal((await run('/id/dashboard', pilgrim)).redirect, null)
  assert.equal((await run('/id/dashboard', 'bukan.jwt.sama-sekali')).redirect?.pathname, '/id/login')
  assert.equal((await run('/id/admin', await token('ngawur'))).redirect?.pathname, '/id/dashboard', 'peran tak dikenal bukan admin')
})

console.log('== gerbang vs kanonikalisasi (S-NI01) ==')

// next-intl mendekode/membersihkan path lalu me-REWRITE ke bentuk kanonik; gerbang harus melihat bentuk yang sama.
const ADMIN_VARIANTS = ['/id/%61dmin', '/id//admin', '/id/%09admin', '/id/%0aadmin', '/id/\\admin', '/ID/admin', '/Id/admin/bookings', '/id///admin/bookings', '/en//admin', '/id/%2561dmin', '/id/%5cadmin', '/id/%61dmin/%62ookings']
const USER_VARIANTS = ['/id//dashboard', '/id/%64ashboard', '/id/%2564ashboard', '/ID/dashboard', '/id/%09dashboard', '/en///bookings/checkout/visa', '/id/%70rofile', '/id/\\bookings']
const isProtectedTarget = (p: string) => /^\/(id|en)\/(admin(?!\/login(\/|$))|dashboard|bookings|profile|lengkapi-data)(\/|$)/.test(p)

await t(`${ADMIN_VARIANTS.length} varian encoding/slash/huruf pada /admin TANPA cookie → login admin (bukan rewrite ke halaman admin); kontrol positif: bentuk polos juga`, async () => {
  assert.equal((await run('/id/admin')).redirect?.pathname, '/id/admin/login', 'kontrol positif')
  for (const p of ADMIN_VARIANTS) {
    const r = await run(p)
    assert.equal(r.status, 307, `${p} → status ${r.status}${r.rewrite ? ` REWRITE→ ${r.rewrite.pathname}` : ''}`)
    assert.match(r.redirect?.pathname ?? '', /^\/(id|en)\/admin\/login$/, p)
  }
})

await t(`${USER_VARIANTS.length} varian pada rute jamaah terlindungi TANPA cookie → login jamaah`, async () => {
  for (const p of USER_VARIANTS) {
    const r = await run(p)
    assert.equal(r.status, 307, `${p} → status ${r.status}${r.rewrite ? ` REWRITE→ ${r.rewrite.pathname}` : ''}`)
    assert.match(r.redirect?.pathname ?? '', /^\/(id|en)\/login$/, p)
  }
})

await t('SIFAT umum: untuk SEMUA varian tanpa cookie, rewrite TIDAK pernah menuju rute terlindungi', async () => {
  for (const p of [...ADMIN_VARIANTS, ...USER_VARIANTS, ...HOSTILE]) {
    const r = await run(p)
    if (r.rewrite) assert.ok(!isProtectedTarget(r.rewrite.pathname), `${p} → rewrite ke rute terlindungi ${r.rewrite.pathname}`)
  }
})

await t('dengan cookie: admin lolos pada varian ber-encoding (kontrol positif, tak di-over-block); jamaah ke varian admin → dashboard', async () => {
  const admin = await token('admin'), pilgrim = await token('pilgrim')
  for (const p of ['/id/%61dmin', '/id//admin', '/ID/admin']) {
    assert.equal((await run(p, admin)).redirect?.pathname.endsWith('/admin/login') ?? false, false, `${p} admin tak boleh dilempar ke login`)
    assert.equal((await run(p, pilgrim)).redirect?.pathname, '/id/dashboard', `${p} jamaah → dashboard`)
  }
  assert.equal((await run('/id//dashboard', pilgrim)).redirect, null, 'jamaah lolos ke dashboard varian')
})

await t('tidak over-block: varian pada rute PUBLIC tetap lolos; `/idadmin` bukan locale id; /admin%2Flogin TIDAK memakai pengecualian /admin/login', async () => {
  for (const p of ['/id//hotels', '/id/%68otels', '/id///login', '/id/admin%2Flogin']) {
    const r = await run(p)
    if (p === '/id/admin%2Flogin') assert.match(r.redirect?.pathname ?? '', /\/admin\/login$/, `${p} harus tetap diperlakukan terlindungi`)
    else assert.ok(!r.redirect || !/\/login$/.test(r.redirect.pathname), `${p} → ${r.redirect?.pathname}`)
  }
  assert.equal((await run('/id/admin/login')).redirect, null, 'login admin tetap publik')
  assert.equal((await run('/idadmin')).redirect?.pathname, '/id/idadmin', '/idadmin diprefiks locale, bukan dianggap /admin')
})

await t('canonicalGatePath: decode berulang (maks 3), buang tab/CR/LF, backslash → slash, kompres slash, %2F tidak didekode, encoding rusak apa adanya', () => {
  assert.equal(canonicalGatePath('/id/%61dmin'), '/id/admin'); assert.equal(canonicalGatePath('/id/%2561dmin'), '/id/admin')
  assert.equal(canonicalGatePath('/id//admin'), '/id/admin'); assert.equal(canonicalGatePath('/id/\\admin'), '/id/admin'); assert.equal(canonicalGatePath('/id/%09admin'), '/id/admin')
  assert.equal(canonicalGatePath('/id/admin%2Flogin'), '/id/admin%2Flogin', '%2F harus tetap terenkode')
  assert.equal(canonicalGatePath('/id/%E0%A4%A'), '/id/%E0%A4%A', 'encoding rusak tidak melempar')
  assert.equal(canonicalGatePath('/id/hotels'), '/id/hotels')
})

console.log('== locale: cookie dan deteksi ==')

await t('localeCookie:false — tak ada set-cookie NEXT_LOCALE (/, /id, /en, /id/hotels); konfigurasi routing terkunci', async () => {
  assert.equal(routing.localeCookie, false)
  for (const p of ['/', '/id', '/en', '/id/hotels', '/hotels']) assert.doesNotMatch((await run(p)).setCookie, /NEXT_LOCALE/, p)
  // cookie NEXT_LOCALE yang disodorkan klien tak boleh memengaruhi hasil
  const r = await middleware(new NextRequest(ORIGIN + '/', { headers: { cookie: 'NEXT_LOCALE=en', 'accept-language': 'id' } }))
  assert.equal(new URL(r.headers.get('location')!, ORIGIN).pathname, '/id', 'cookie klien diabaikan; Accept-Language menang')
})

await t('Accept-Language: en → /en; id → /id; aneh/kosong/`*` → /id; header tak pernah masuk ke Location', async () => {
  for (const [al, want] of [['en', '/en'], ['en-US,en;q=0.9', '/en'], ['id', '/id'], ['id-ID', '/id'], ['*', '/id'], ['', '/id'], ['xx-YY', '/id'], ['en;q=abc', '/id']] as const) {
    const r = await run('/', undefined, al ? { 'accept-language': al } : undefined)
    assert.equal(r.redirect?.pathname, want, JSON.stringify(al))
    assert.equal(r.redirect?.origin, ORIGIN)
  }
})

console.log('== matcher ==')

// Sintaks matcher Next = path-to-regexp; untuk bentuk `/((?!...).*)` cukup memakai grup regex-nya langsung.
const matches = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path))
await t('matcher TIDAK melepas rute terlindungi/locale dan melepas aset (_next, berkas ber-titik); /api boleh masuk atau tidak', () => {
  for (const p of ['/', '/id', '/en', '/id/dashboard', '/id/admin', '/id/admin/login', '/id/bookings/checkout/visa', '/id/bookings', '/id/profile', '/id/lengkapi-data', '/hotels']) {
    assert.ok(matches(p), `harus dicocokkan matcher: ${p}`)
  }
  for (const p of ['/_next/static/chunks/app.js', '/favicon.ico', '/robots.txt', '/images/logo.png']) assert.ok(!matches(p), `harus dilepas matcher: ${p}`)
})

await t('penjaga sumber: middleware.ts tidak mengimpor session.ts (Prisma tak boleh masuk bundel Edge) dan jwtVerify membatasi algoritma', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('middleware.ts', 'utf8')
  assert.doesNotMatch(src, /from '@\/lib\/auth\/session'/); assert.match(src, /algorithms:\s*\['HS256'\]/)
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
