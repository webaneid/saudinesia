// Penjaga batas ukuran body di Caddy (GHSA-mrhx-c7xc-m3w5; docs/lessons-learned.md SEC-211). Statis, tanpa database/Redis.
// Zod 3 memvalidasi SEMUA elemen array meski `.max()` terlampaui, jadi body JSON besar = RAM habis. Caddy memberi 8 MB hanya
// untuk POST ke route unggah (`@unggah`), selain itu 1 MB. Yang dikunci: setiap route yang membaca multipart tercakup
// `@unggah` (kalau tidak, unggahan > 1 MB ditolak di production), route lain TIDAK tercakup, dan jalur akal-akalan tak lolos.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 12).join('\n     ')}`)
  }
}

const read = (f: string) => readFileSync(f, 'utf8')
const caddy = read('Caddyfile')
const block = /@unggah \{\n([\s\S]*?)\n\s*\}/.exec(caddy)?.[1] ?? ''
const pattern = /path_regexp (\S+)/.exec(block)?.[1] ?? ''
const upload = new RegExp(pattern)

const API = 'app/api'
const routes = (readdirSync(API, { recursive: true }) as string[]).filter(f => f.endsWith('route.ts')).map(f => join(API, f)).sort()
// Pembaca multipart di lib — route yang memakainya adalah route unggah.
const LIB_READERS: Record<string, RegExp> = { 'lib/documents/http.ts': /\breadUpload\(/, 'lib/media/handlers.ts': /\blistPOST\b/ }
const isUploadRoute = (src: string) => /\.formData\(\)/.test(src) || Object.values(LIB_READERS).some(re => re.test(src))
// app/api/v1/a/[id]/b/route.ts → /api/v1/a/cm9abc_1-x/b (segmen dinamis diisi bentuk id sungguhan: cuid/uuid/enum).
const urlOf = (f: string) => '/' + relative('app', f).split(sep).slice(0, -1).map(s => (s.startsWith('[') ? 'cm9abc_1-x' : s)).join('/')

await t('Caddyfile: @unggah hanya POST, 8 MB di cabang unggah dan 1 MB untuk selain itu', () => {
  assert.ok(pattern.startsWith('^/api/v1/') && pattern.endsWith('$'), `path_regexp @unggah tak ditemukan/tak berjangkar: ${pattern}`)
  assert.match(block, /^\s*method POST$/m)
  assert.match(caddy, /handle @unggah \{\s*request_body \{\s*max_size 8MB\s*\}\s*import aplikasi\s*\}/)
  assert.match(caddy, /handle \{\s*request_body \{\s*max_size 1MB\s*\}\s*import aplikasi\s*\}/)
  assert.ok(!/max_size 8MB/.test(caddy.replace(/handle @unggah \{[\s\S]*?import aplikasi\s*\}/, '')), '8 MB muncul di luar cabang @unggah')
})

await t('pembaca multipart hanya di tempat yang dikenal (helper baru = daftarkan di LIB_READERS)', () => {
  const libs = (readdirSync('lib', { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f)).map(f => join('lib', f))
  const found = libs.filter(f => /\.formData\(\)/.test(read(f))).sort()
  assert.deepEqual(found, Object.keys(LIB_READERS).sort())
})

const uploads = routes.filter(f => isUploadRoute(read(f)))

await t('pemindai menemukan route unggah (bukan lulus karena kosong)', () => {
  assert.ok(routes.length > 100, `hanya ${routes.length} route`)
  assert.ok(uploads.length >= 6, `hanya ${uploads.length} route unggah: ${uploads.join(', ')}`)
})

await t('setiap route unggah tercakup @unggah (kalau tidak, unggahan > 1 MB ditolak Caddy)', () => {
  const missed = uploads.filter(f => !upload.test(urlOf(f)))
  assert.deepEqual(missed, [], `tambahkan ke path_regexp @unggah di Caddyfile: ${missed.map(urlOf).join(', ')}`)
})

await t('route unggah tidak membaca JSON (8 MB tak boleh sampai ke Zod)', () => {
  const json = uploads.filter(f => /\.json\(\)/.test(read(f)))
  assert.deepEqual(json, [])
  assert.ok(!/\.json\(\)/.test(/async function listPOST[\s\S]*?\n  \}\n/.exec(read('lib/media/handlers.ts'))?.[0] ?? '.json()'), 'listPOST membaca JSON')
})

await t('route selain unggah TIDAK tercakup @unggah (tetap 1 MB)', () => {
  const extra = routes.filter(f => !uploads.includes(f) && upload.test(urlOf(f)))
  assert.deepEqual(extra.map(urlOf), [])
})

await t('jalur akal-akalan tak meminjam batas unggah', () => {
  for (const u of [
    '/api/v1/account/pilgrims/../../bookings/documents',
    '/api/v1/account/pilgrims/%2e%2e/documents',
    '/api/v1/admin/media/x/y/../../../bookings',
    '/api/v1/admin/media/x/y/z',
    '/api/v1/bookings/x/payment/bukti/x',
    '//api/v1/bookings/x/payment/bukti',
    '/id/api/v1/bookings/x/payment/bukti',
    '/api/v1/bookings',
  ]) assert.ok(!upload.test(u), `cocok padahal tak boleh: ${u}`)
  assert.ok(upload.test('/api/v1/bookings/x/payment/bukti/'))
})

if (failed) {
  console.log(`${failed} GAGAL`)
  process.exit(1)
}
