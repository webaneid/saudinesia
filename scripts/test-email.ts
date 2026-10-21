// Uji lib/email/resend.ts + lib/email/templates.ts (docs/arsitektur-notifikasi.md). Tanpa framework: skrip Bun, keluar non-nol bila gagal.
// Resend digantikan SERVER PALSU lokal (RESEND_API_URL, hanya dihormati saat NODE_ENV test/development) — tidak ada jaringan nyata.
import assert from 'node:assert/strict'
import { emailConfigured, sendEmail } from '@/lib/email/resend'
import { emailContent, esc } from '@/lib/email/templates'
import type { NotificationEvent } from '@/lib/notifications/events'
import { startFakeServer } from './lib/fakeServer'

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
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'test'

// ───────────── server Resend palsu ─────────────
import type { FakeRequest as Seen } from './lib/fakeServer'
let script: Array<{ status: number; body?: unknown; headers?: Record<string, string> }> = []
let seen: Seen[] = []
const server = await startFakeServer((req) => {
  seen.push(req)
  return script.shift() ?? { status: 200, body: { id: 'msg_default' } }
})
const BASE = `http://127.0.0.1:${server.port}`
const reset = (steps: typeof script = []) => { script = steps; seen = [] }
const withKey = () => { env.RESEND_API_KEY = 're_test_secret_key_123'; env.RESEND_FROM = 'Saudinesia <noreply@saudinesia.test>'; env.RESEND_API_URL = BASE; delete env.RESEND_REPLY_TO }
const mail = { to: 'jamaah@example.test', subject: 'Halo', html: '<p>hai</p>', text: 'hai' }

console.log('== klien Resend ==')

await t('tanpa RESEND_API_KEY → skipped, TIDAK ada request', async () => {
  withKey(); delete env.RESEND_API_KEY; reset()
  const r = await sendEmail(mail)
  assert.equal(r.status, 'skipped')
  assert.match((r as { reason: string }).reason, /RESEND_API_KEY/)
  assert.equal(seen.length, 0)
  assert.equal(emailConfigured(), false)
})

await t('tanpa RESEND_FROM → skipped', async () => {
  withKey(); delete env.RESEND_FROM; reset()
  const r = await sendEmail(mail)
  assert.equal(r.status, 'skipped')
  assert.match((r as { reason: string }).reason, /RESEND_FROM/)
  assert.equal(seen.length, 0)
})

await t('sukses: request benar (path, auth, idempotency, isi JSON) dan id dikembalikan', async () => {
  withKey(); reset([{ status: 200, body: { id: 'msg_abc123' } }])
  const r = await sendEmail({ ...mail, idempotencyKey: 'kunci-1' })
  assert.deepEqual(r, { status: 'sent', id: 'msg_abc123' })
  assert.equal(seen.length, 1)
  const q = seen[0]!
  assert.equal(q.method, 'POST')
  assert.equal(q.path, '/emails')
  assert.equal(q.headers.get('authorization'), 'Bearer re_test_secret_key_123')
  assert.equal(q.headers.get('idempotency-key'), 'kunci-1')
  assert.equal(q.headers.get('content-type'), 'application/json')
  assert.deepEqual(q.body, { from: 'Saudinesia <noreply@saudinesia.test>', to: ['jamaah@example.test'], subject: 'Halo', html: '<p>hai</p>', text: 'hai' })
  assert.equal(emailConfigured(), true)
})

await t('reply_to ikut terkirim hanya bila RESEND_REPLY_TO diisi', async () => {
  withKey(); env.RESEND_REPLY_TO = 'cs@saudinesia.test'; reset()
  await sendEmail(mail)
  assert.equal(seen[0]!.body.reply_to, 'cs@saudinesia.test')
  delete env.RESEND_REPLY_TO; reset()
  await sendEmail(mail)
  assert.equal('reply_to' in seen[0]!.body, false)
})

await t('alamat tujuan tidak valid → failed tanpa request', async () => {
  withKey(); reset()
  for (const bad of ['bukan-email', 'a@b', 'a b@c.test', 'a@b.test, c@d.test', '"x"@y.test', 'a@b.test\r\nBcc: x@y.test', '']) {
    const r = await sendEmail({ ...mail, to: bad })
    assert.equal(r.status, 'failed', `harus ditolak: ${JSON.stringify(bad)}`)
  }
  assert.equal(seen.length, 0)
})

await t('subjek: CR/LF dibuang (satu baris), dipotong 250 karakter', async () => {
  withKey(); reset()
  await sendEmail({ ...mail, subject: 'Baris1\r\nBcc: x@y.test\nBaris3' })
  assert.equal(seen[0]!.body.subject, 'Baris1 Bcc: x@y.test Baris3')
  reset()
  await sendEmail({ ...mail, subject: 'x'.repeat(400) })
  assert.equal((seen[0]!.body.subject as string).length, 250)
})

await t('500, 500, lalu 200 → di-retry dan akhirnya sent (3 request, kunci idempotensi sama)', async () => {
  withKey(); reset([{ status: 500 }, { status: 502 }, { status: 200, body: { id: 'msg_retry' } }])
  const r = await sendEmail({ ...mail, idempotencyKey: 'k-retry' })
  assert.deepEqual(r, { status: 'sent', id: 'msg_retry' })
  assert.equal(seen.length, 3)
  assert.ok(seen.every((s) => s.headers.get('idempotency-key') === 'k-retry'))
})

await t('500 terus-menerus → failed setelah tepat 3 percobaan', async () => {
  withKey(); reset([{ status: 500, body: { message: 'boom' } }, { status: 500 }, { status: 503 }])
  const r = await sendEmail(mail)
  assert.equal(r.status, 'failed')
  assert.match((r as { error: string }).error, /HTTP 503/)
  assert.equal(seen.length, 3)
})

await t('429 dengan Retry-After → menunggu lalu berhasil', async () => {
  withKey(); reset([{ status: 429, headers: { 'retry-after': '1' } }, { status: 200, body: { id: 'msg_429' } }])
  const t0 = Date.now()
  const r = await sendEmail(mail)
  const dt = Date.now() - t0
  assert.equal(r.status, 'sent')
  assert.equal(seen.length, 2)
  assert.ok(dt >= 900 && dt < 3000, `menunggu ~1 detik, ukur ${dt}ms`)
})

await t('4xx (422/401/403/400) → failed SEGERA, tidak di-retry', async () => {
  for (const status of [422, 401, 403, 400]) {
    withKey(); reset([{ status, body: { message: 'domain belum terverifikasi' } }])
    const r = await sendEmail(mail)
    assert.equal(r.status, 'failed')
    assert.match((r as { error: string }).error, new RegExp(`HTTP ${status}`))
    assert.equal(seen.length, 1, `status ${status} tidak boleh di-retry`)
  }
})

await t('kunci API TIDAK PERNAH muncul di pesan galat', async () => {
  withKey(); reset([{ status: 401, body: { message: 'Invalid API key re_test_secret_key_123' } }])
  const r = await sendEmail(mail)
  assert.equal(r.status, 'failed')
  const msg = (r as { error: string }).error
  assert.ok(!msg.includes('re_test_secret_key_123'), `kunci bocor: ${msg}`)
  assert.match(msg, /\[redacted\]/, 'harus ada penanda redaksi (membuktikan server memang memantulkan kunci)')
  assert.doesNotMatch(msg, /Bearer|Authorization/i)
})

await t('jaringan mati → failed setelah 3 percobaan dengan jeda (tidak menggantung, tidak melempar)', async () => {
  withKey(); env.RESEND_API_URL = 'http://127.0.0.1:1'; reset()
  const t0 = Date.now()
  const r = await sendEmail(mail)
  const dt = Date.now() - t0
  assert.equal(r.status, 'failed')
  assert.ok(dt >= 1800 && dt < 6000, `jeda 500+1500ms, ukur ${dt}ms`)
})

await t('RESEND_API_URL hanya dihormati di development/test (production → api.resend.com)', async () => {
  const realFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (u: string | URL | Request) => { urls.push(String(u)); return new Response('{"id":"x"}', { status: 200 }) }) as typeof fetch
  try {
    withKey()
    for (const nodeEnv of ['production', 'staging', undefined, 'test', 'development']) {
      if (nodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = nodeEnv
      urls.length = 0
      await sendEmail(mail)
      const expectOverride = nodeEnv === 'test' || nodeEnv === 'development'
      assert.ok(urls[0]!.startsWith(expectOverride ? BASE : 'https://api.resend.com'), `NODE_ENV=${nodeEnv}: ${urls[0]}`)
    }
  } finally { globalThis.fetch = realFetch; env.NODE_ENV = 'test' }
})

console.log('== template ==')
const EVENTS: NotificationEvent[] = [
  { type: 'booking_submitted', code: 'SND-0001', deadline: '25 Oktober 2026 10.00' },
  { type: 'booking_submitted', code: 'SND-0001', deadline: null },
  { type: 'payment_reminder_12h', code: 'SND-0002', deadline: '25 Oktober 2026 10.00' },
  { type: 'payment_reminder_22h', code: 'SND-0002', deadline: '25 Oktober 2026 10.00' },
  { type: 'payment_confirmed', code: 'SND-0003' },
  { type: 'payment_rejected', code: 'SND-0003' },
  { type: 'auto_cancelled', code: 'SND-0004' },
  { type: 'visa_status_change', code: 'SND-0005', status: 'Visa Terbit' },
  { type: 'welcome', name: 'Budi Santoso' },
  { type: 'test' },
]

await t('setiap kejadian menghasilkan subjek/html/teks utuh tanpa sisa "undefined"/"NaN"', () => {
  env.APP_URL = 'https://saudinesia.test'
  for (const e of EVENTS) {
    const c = emailContent(e, { name: 'Budi Santoso', bookingId: 'bk-1' })
    assert.ok(c.subject.length > 3 && !/[\r\n]/.test(c.subject), `${e.type}: subjek`)
    assert.ok(c.html.startsWith('<!doctype html>'), `${e.type}: html`)
    assert.ok(c.text.length > 20, `${e.type}: teks`)
    for (const bad of ['undefined', 'NaN', '[object', 'null']) {
      assert.ok(!c.html.includes(bad) && !c.text.includes(bad), `${e.type}: memuat "${bad}"`)
    }
  }
})

await t('esc(): kelima karakter berbahaya di-escape', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;')
})

await t('nama, kode, status, tenggat berisi HTML TIDAK lolos mentah ke html (mencegah injeksi/phishing)', () => {
  const evil = `<img src=x onerror=alert(1)>"'&<script>x</script>`
  const events: NotificationEvent[] = [
    { type: 'booking_submitted', code: evil, deadline: evil },
    { type: 'visa_status_change', code: evil, status: evil },
    { type: 'welcome', name: evil },
  ]
  for (const e of events) {
    const c = emailContent(e, { name: evil, bookingId: 'bk' })
    assert.ok(!c.html.includes('<img src=x'), `${e.type}: <img mentah`)
    assert.ok(!c.html.includes('<script>x'), `${e.type}: <script mentah`)
    assert.ok(!/onerror=alert\(1\)>[^&]/.test(c.html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), `${e.type}: handler lolos`)
    assert.ok(c.html.includes('&lt;img'), `${e.type}: harus ada versi ter-escape`)
  }
})

await t('tautan: APP_URL + path internal; id di-encode; tanpa APP_URL → TIDAK ada tautan sama sekali', () => {
  env.APP_URL = 'https://saudinesia.test/'
  const c = emailContent({ type: 'payment_confirmed', code: 'X' }, { name: 'A', bookingId: 'a/b?c=1' })
  assert.ok(c.html.includes('href="https://saudinesia.test/id/bookings/a%2Fb%3Fc%3D1"'), 'tautan ter-encode, tanpa // ganda')
  assert.ok(c.text.includes('https://saudinesia.test/id/bookings/a%2Fb%3Fc%3D1'))
  delete env.APP_URL; delete env.NEXT_PUBLIC_APP_URL
  const n = emailContent({ type: 'payment_confirmed', code: 'X' }, { name: 'A', bookingId: 'bk' })
  assert.ok(!/href="\//.test(n.html) && !n.html.includes('href="undefined'), 'tidak boleh ada tautan relatif')
  assert.ok(!n.html.includes('<a href="https://saudinesia'), 'tidak ada CTA')
})

await t('APP_URL yang mengandung tanda kutip tidak bisa keluar dari atribut href', () => {
  env.APP_URL = 'https://x.test" onmouseover="alert(1)'
  const c = emailContent({ type: 'payment_confirmed', code: 'X' }, { name: 'A', bookingId: 'bk' })
  assert.ok(!/href="[^"]*" onmouseover=/.test(c.html), 'atribut injeksi lolos')
  assert.ok(c.html.includes('&quot; onmouseover=&quot;'))
  delete env.APP_URL
})

await t('kejadian tanpa CTA (auto_cancelled) tidak memuat tombol; test/welcome memuat footnote/CTA sesuai', () => {
  env.APP_URL = 'https://saudinesia.test'
  assert.ok(!emailContent({ type: 'auto_cancelled', code: 'X' }, { name: 'A' }).html.includes('<a href="https://saudinesia.test/id/'))
  assert.ok(emailContent({ type: 'test' }, { name: 'A' }).html.includes('panel admin'))
  assert.ok(emailContent({ type: 'welcome', name: 'A' }, { name: 'A' }).html.includes('href="https://saudinesia.test/id"'))
  delete env.APP_URL
})

await server.stop()
console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
