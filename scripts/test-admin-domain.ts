// Penjaga domain admin terpisah (docs/rencana-domain-admin.md). Tanpa database.
// 1) Penemu sumber: alamat halaman admin HANYA lewat `adminHref` (lib/admin/href.ts) — tak ada `/${locale}/admin…`/`'/id/admin…'` tulisan tangan.
// 2) Helper alamat di mode jalur dan mode domain. 3) Aturan host (API, login). 4) Middleware sungguhan atas beberapa host.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'

let failed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 8).join('\n     ')}`) }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) } else if (/\.(tsx?|mts)$/.test(name)) out.push(p)
  }
  return out
}

console.log('== penemu sumber ==')
await t('tak ada alamat halaman admin tulisan tangan di app/components/lib', () => {
  const allowed = new Set(['lib/admin/href.ts'])
  const bad: string[] = []
  const patterns = [
    /`\/\$\{[^}]+\}\/admin(?!\/api)/,          // `/${locale}/admin…`
    /['"`]\/(id|en)\/admin/,                  // '/id/admin…'
    /`\/\$\{(locale|loc)\}\$\{[^}`?]*\.(path|href)\}`/, // `/${locale}${item.path}` (jalur logis menu/harga)
    /(href|backHref|resetHref)=["']\/admin/,  // href="/admin…"
  ]
  for (const f of [...walk('app'), ...walk('components'), ...walk('lib')]) {
    if (allowed.has(f)) continue
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*(\*|\/\*).*$/, '')
      if (patterns.some(re => re.test(code)) && !/api\/v1/.test(code) && !code.includes('adminHref')) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`)
    })
  }
  assert.deepEqual(bad, [])
})

await t('infra: Caddy punya blok admin + penolakan per host, file boleh di-frame dua host, compose/generator mewajibkan ADMIN_DOMAIN', () => {
  const caddy = readFileSync('Caddyfile', 'utf8')
  assert.match(caddy, /^\{\$ADMIN_DOMAIN\} \{/m)
  assert.match(caddy, /frame-ancestors https:\/\/\{\$APP_DOMAIN\} https:\/\/\{\$ADMIN_DOMAIN\}/)
  const app = caddy.slice(caddy.indexOf('{$APP_DOMAIN} {'), caddy.indexOf('{$ADMIN_DOMAIN} {'))
  const admin = caddy.slice(caddy.indexOf('{$ADMIN_DOMAIN} {'), caddy.indexOf('{$FILES_DOMAIN} {'))
  // `respond` bertingkat lebih rendah dari `handle` di urutan bawaan Caddy — penolakan wajib di dalam `handle` agar tak dilewati batas_body.
  for (const [blok, m] of [[app, 'adminDiApp'], [app, 'apiAdminDiApp'], [admin, 'jamaahDiAdmin']] as const) {
    assert.match(blok, new RegExp(`handle @${m} \\{\\s*respond 404`), m)
  }
  assert.match(admin, /X-Robots-Tag "noindex, nofollow"/)
  for (const b of [app, admin]) assert.match(b, /import batas_body/)
  const compose = readFileSync('docker-compose.prod.yml', 'utf8')
  assert.equal((compose.match(/ADMIN_DOMAIN: \$\{ADMIN_DOMAIN:\?/g) ?? []).length, 2, 'web dan caddy wajib menerima ADMIN_DOMAIN')
  assert.match(readFileSync('scripts/buat-env-production.sh', 'utf8'), /ADMIN_DOMAIN="\$\{2:/)
  assert.match(readFileSync('.env.production.example', 'utf8'), /^ADMIN_DOMAIN=$/m)
})

const { adminHref, adminLogicalPath, publicHref } = await import('../lib/admin/href')
const { hostKind, apiBlockedOnHost, loginHostRefusal, bareHost } = await import('../lib/admin/domain')

console.log('== helper alamat ==')
await t('mode jalur (ADMIN_DOMAIN kosong): perilaku lama', () => {
  delete process.env.ADMIN_DOMAIN
  assert.equal(adminHref('id', '/admin'), '/id/admin')
  assert.equal(adminHref('en', '/admin/bookings/x?tab=1'), '/en/admin/bookings/x?tab=1')
  assert.equal(adminLogicalPath('/id/admin/bookings/1'), '/admin/bookings/1')
  assert.equal(publicHref('/id/visa', 'https://app.example.test'), '/id/visa')
  assert.throws(() => adminHref('id', '/bookings'))
  assert.throws(() => adminHref('id', '/administrasi'))
})
await t('mode domain: tanpa awalan, halaman publik absolut ke host app', () => {
  process.env.ADMIN_DOMAIN = 'admin.example.test'
  assert.equal(adminHref('id', '/admin'), '/')
  assert.equal(adminHref('en', '/admin/bookings/x'), '/bookings/x')
  assert.equal(adminHref('id', '/admin?tab=1'), '/?tab=1')
  assert.equal(adminHref('id', '/admin/login'), '/login')
  assert.equal(adminLogicalPath('/'), '/admin')
  assert.equal(adminLogicalPath('/finance/refunds'), '/admin/finance/refunds')
  assert.equal(publicHref('/id/visa', 'https://app.example.test'), 'https://app.example.test/id/visa')
})

await t('staffPanelHref (halaman publik → panel admin): relatif di satu host, absolut ke host admin di mode domain', async () => {
  const { staffPanelHref } = await import('../lib/auth/staffPanel')
  delete process.env.ADMIN_DOMAIN
  assert.equal(staffPanelHref('en', '/admin/bookings'), '/en/admin/bookings')
  process.env.ADMIN_DOMAIN = 'admin.example.test'
  process.env.APP_URL = 'https://app.example.test'
  assert.equal(staffPanelHref('id', '/admin/bookings'), 'https://admin.example.test/bookings')
  assert.equal(staffPanelHref('id', '/admin'), 'https://admin.example.test/')
  process.env.APP_URL = 'http://localhost:6260'
  assert.equal(staffPanelHref('id', '/admin'), 'http://admin.example.test:6260/')
  assert.throws(() => staffPanelHref('id', '/bookings'))
  delete process.env.APP_URL
})

console.log('== aturan host ==')
await t('jenis host, API yang ditolak, login per host', () => {
  process.env.ADMIN_DOMAIN = 'Admin.Example.Test.'
  assert.equal(bareHost('ADMIN.example.test:443'), 'admin.example.test')
  assert.equal(hostKind('admin.example.test:6260'), 'admin')
  assert.equal(hostKind('app.example.test'), 'app')
  assert.equal(hostKind(null), 'app')
  assert.equal(apiBlockedOnHost('app', '/api/v1/admin/bookings'), true)
  assert.equal(apiBlockedOnHost('app', '/api/v1/administrasi'), false)
  assert.equal(apiBlockedOnHost('app', '/api/v1/bookings'), false)
  assert.equal(apiBlockedOnHost('admin', '/api/v1/admin/bookings'), false)
  for (const p of ['/api/v1/auth/google/start', '/api/v1/auth/register', '/api/v1/auth/registration/preview', '/api/v1/webhooks/ipaymu']) assert.equal(apiBlockedOnHost('admin', p), true, p)
  assert.equal(apiBlockedOnHost('admin', '/api/v1/auth/login'), false)
  assert.equal(loginHostRefusal('app', true), 'staffUseAdminDomain')
  assert.equal(loginHostRefusal('admin', false), 'adminDomainStaffOnly')
  assert.equal(loginHostRefusal('admin', true), null)
  assert.equal(loginHostRefusal('app', false), null)
  delete process.env.ADMIN_DOMAIN
  assert.equal(hostKind('apa.saja'), 'single')
  assert.equal(apiBlockedOnHost('single', '/api/v1/admin/x'), false)
  assert.equal(loginHostRefusal('single', true), null)
})

console.log('== middleware ==')
process.env.JWT_SECRET ||= 'uji-domain-admin-rahasia-panjang-lebih-dari-32-karakter'
const { middleware } = await import('../middleware')
const token = (role: string) => new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
  .sign(new TextEncoder().encode(process.env.JWT_SECRET))
const staff = await token('admin')
const pilgrim = await token('pilgrim')
async function hit(host: string, path: string, cookie?: string) {
  const headers: Record<string, string> = { host }
  if (cookie) headers.cookie = `snd-session=${cookie}`
  const res = await middleware(new NextRequest(`https://${host}${path}`, { headers }))
  return { status: res.status, location: res.headers.get('location'), rewrite: res.headers.get('x-middleware-rewrite') }
}
const path = (u: string | null) => (u ? new URL(u).pathname + new URL(u).search : null)

await t('host admin: alamat ramah di-rewrite, gerbang role, 308 jalur lama, publik 404, API jamaah 404', async () => {
  process.env.ADMIN_DOMAIN = 'admin.example.test'
  const A = 'admin.example.test'
  let r = await hit(A, '/bookings?q=1', staff)
  assert.equal(path(r.rewrite), '/id/admin/bookings?q=1')
  r = await hit(A, '/', staff); assert.equal(path(r.rewrite), '/id/admin')
  r = await hit(A, '/login'); assert.equal(path(r.rewrite), '/id/admin/login')
  r = await hit(A, '/bookings'); assert.equal(r.status, 307); assert.equal(path(r.location), '/login')
  r = await hit(A, '/bookings', pilgrim); assert.equal(path(r.location), '/login')
  r = await hit(A, '/id/admin/bookings/9?x=1', staff); assert.equal(r.status, 308); assert.equal(path(r.location), '/bookings/9?x=1')
  r = await hit(A, '/ID/admin'); assert.equal(r.status, 308); assert.equal(path(r.location), '/')
  r = await hit(A, '/id/packages', staff); assert.equal(r.status, 404)
  r = await hit(A, '/en', staff); assert.equal(r.status, 404)
  r = await hit(A, '/id/%61dmin/x', staff); assert.equal(r.status, 308) // jalur dikanonikalkan dulu
  r = await hit(A, '/login/%252e%252e/%252e%252e/dashboard'); assert.equal(r.status, 404) // %2e%2e dinormalkan parser URL; tersandi ganda baru terdekode di gerbang
  r = await hit(A, '/%252e%252e/id/dashboard', staff); assert.equal(r.status, 404)
  r = await hit(A, '/login/x'); assert.equal(path(r.location), '/login') // gerbang hanya membebaskan /login persis
  r = await hit(A, '/api/v1/auth/register'); assert.equal(r.status, 404)
  r = await hit(A, '/api/v1/admin/bookings'); assert.equal(r.status, 200)
})
await t('host app: admin 404 (juga bentuk tersandi/tanpa locale), API admin 404, halaman publik normal', async () => {
  process.env.ADMIN_DOMAIN = 'admin.example.test'
  const P = 'app.example.test'
  for (const p of ['/id/admin', '/id/admin/login', '/en/admin/bookings', '/id/%61dmin', '/id//admin', '/admin', '/admin/bookings']) {
    assert.equal((await hit(P, p, staff)).status, 404, p)
  }
  assert.equal((await hit(P, '/api/v1/admin/bookings', staff)).status, 404)
  assert.equal((await hit(P, '/api/v1/admin/x/file.pdf', staff)).status, 404)
  assert.notEqual((await hit(P, '/id', undefined)).status, 404)
  assert.equal((await hit(P, '/id/dashboard')).status, 307)
})
await t('satu host (ADMIN_DOMAIN kosong): perilaku lama tidak berubah', async () => {
  delete process.env.ADMIN_DOMAIN
  const H = 'localhost:6260'
  let r = await hit(H, '/id/admin/bookings'); assert.equal(path(r.location), '/id/admin/login')
  r = await hit(H, '/id/admin/login'); assert.notEqual(r.status, 404)
  r = await hit(H, '/id/admin', pilgrim); assert.equal(path(r.location), '/id/dashboard')
  r = await hit(H, '/api/v1/admin/bookings'); assert.equal(r.status, 200)
})

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
