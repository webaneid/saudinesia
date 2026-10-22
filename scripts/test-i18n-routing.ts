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

type Outcome = { status: number; redirect: URL | null }
async function run(path: string, cookie?: string): Promise<Outcome> {
  const res = await call(path, cookie)
  const loc = res.headers.get('location')
  return { status: res.status, redirect: loc ? new URL(loc, ORIGIN) : null }
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
    if (!r.redirect) continue
    assert.equal(r.redirect.origin, ORIGIN, `${p} → ${r.redirect.href}`)
    assert.ok(!r.redirect.pathname.startsWith('//'), `${p} → path scheme-relative ${r.redirect.pathname}`)
    assert.ok(!r.redirect.href.toLowerCase().includes('evil.com/') || r.redirect.origin === ORIGIN, p)
  }
})

console.log('== gerbang auth kasar ==')

await t('rute jamaah tanpa cookie → login jamaah; /admin tanpa cookie → login admin; /admin/login publik; rute publik & /api dilewati', async () => {
  for (const p of ['/id/dashboard', '/id/bookings/checkout/visa', '/id/groups', '/id/profile', '/id/lengkapi-data', '/en/dashboard']) {
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

console.log('== matcher ==')

// Sintaks matcher Next = path-to-regexp; untuk bentuk `/((?!...).*)` cukup memakai grup regex-nya langsung.
const matches = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path))
await t('matcher TIDAK melepas rute terlindungi/locale dan melepas aset (_next, berkas ber-titik); /api boleh masuk atau tidak', () => {
  for (const p of ['/', '/id', '/en', '/id/dashboard', '/id/admin', '/id/admin/login', '/id/bookings/checkout/visa', '/id/groups', '/id/profile', '/id/lengkapi-data', '/hotels']) {
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
