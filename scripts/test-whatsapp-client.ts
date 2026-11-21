// Klien GOWA v9 (lib/whatsapp/client.ts, docs/rencana-gowa-self-host.md §3) terhadap GOWA tiruan yang meniru openapi v9.9.0:
// Basic auth, POST /send/message, /app/status|login|login-with-code|logout|reconnect, gambar QR di /statics/qrcode. Tanpa DB.
import assert from 'node:assert/strict'
import { startFakeServer, type FakeRequest } from './lib/fakeServer'
import { whatsapp, jidDigits } from '@/lib/whatsapp/client'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 8).join('\n     ')}`) }
}
const env = process.env as Record<string, string | undefined>
const USER = 'saudinesia', PASS = 'sandi-uji-0123456789'
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])

let seen: FakeRequest[] = []
let state = { loggedIn: false, jid: '', qrLink: '', qrBody: PNG as Buffer | string, sendStatus: 200, pair: 'ABCD-1234' }
const gowa = await startFakeServer((req) => {
  seen.push(req)
  if (req.headers.get('authorization') !== AUTH) return { status: 401, body: { code: 'UNAUTHORIZED' } }
  if (req.path === '/app/status') return { status: 200, body: { code: 'SUCCESS', results: { is_connected: true, is_logged_in: state.loggedIn, device_id: 'x', jid: state.jid } } }
  if (req.path === '/app/login') return { status: 200, body: { code: 'SUCCESS', results: { qr_link: state.qrLink, qr_duration: 30 } } }
  if (req.path.startsWith('/statics/qrcode/')) return { status: 200, body: state.qrBody, headers: { 'content-type': 'image/png' } }
  if (req.path === '/app/login-with-code') return { status: 200, body: { code: 'SUCCESS', results: { pair_code: state.pair } } }
  if (req.path === '/app/logout' || req.path === '/app/reconnect') return { status: 200, body: { code: 'SUCCESS' } }
  if (req.method === 'POST' && req.path === '/send/message') return { status: state.sendStatus, body: { code: 'SUCCESS' } }
  return { status: 404, body: {} }
})
const BASE = `http://127.0.0.1:${gowa.port}`
function reset(over: Partial<typeof state> = {}) {
  env.WA_GATEWAY_URL = BASE; env.WA_GATEWAY_USER = USER; env.WA_GATEWAY_PASSWORD = PASS
  seen = []
  state = { loggedIn: false, jid: '', qrLink: `http://localhost:3000/statics/qrcode/scan-qr-6f1c2d3e-aaaa-bbbb-cccc-1234567890ab.png`, qrBody: PNG, sendStatus: 200, pair: 'ABCD-1234', ...over }
}

await t('kirim: POST /send/message dengan Basic auth, nomor digit saja', async () => {
  reset()
  const r = await whatsapp.sendMessage({ phone: '+62 812-3456-7890', message: 'Halo' })
  assert.deepEqual(r, { status: 'sent' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.path, '/send/message'); assert.equal(seen[0]!.method, 'POST')
  assert.deepEqual(seen[0]!.body, { phone: '6281234567890', message: 'Halo' })
})
await t('kirim: kredensial salah (401) → gagal TANPA coba ulang; tanpa URL → dilewati', async () => {
  reset(); env.WA_GATEWAY_PASSWORD = 'salah'
  const r = await whatsapp.sendMessage({ phone: '6281234567890', message: 'x' })
  assert.equal(r.status, 'failed'); assert.equal(seen.length, 1)
  delete env.WA_GATEWAY_URL
  assert.equal((await whatsapp.sendMessage({ phone: '6281234567890', message: 'x' })).status, 'skipped')
})
await t('status: terputus / terhubung + nomor dari JID / 401 = kredensial salah / tak terjangkau', async () => {
  reset()
  assert.deepEqual(await whatsapp.status(), { reachable: true, connected: false, unauthorized: false, phone: null })
  reset({ loggedIn: true, jid: '6281234567890:12@s.whatsapp.net' })
  assert.deepEqual(await whatsapp.status(), { reachable: true, connected: true, unauthorized: false, phone: '6281234567890' })
  reset(); env.WA_GATEWAY_PASSWORD = 'salah'
  assert.deepEqual(await whatsapp.status(), { reachable: true, connected: null, unauthorized: true, phone: null })
  reset(); env.WA_GATEWAY_URL = 'http://127.0.0.1:1'
  assert.deepEqual(await whatsapp.status(), { reachable: false, connected: null, unauthorized: false, phone: null })
})
await t('jidDigits: hanya JID nomor pribadi', () => {
  assert.equal(jidDigits('6281234567890@s.whatsapp.net'), '6281234567890')
  assert.equal(jidDigits('12036302@g.us'), null); assert.equal(jidDigits('abc@s.whatsapp.net'), null); assert.equal(jidDigits(null), null)
})
await t('QR: gambar diambil di server dari WA_GATEWAY_URL (host di qr_link diabaikan) → data URI PNG', async () => {
  reset({ qrLink: 'http://penyerang.example:9999/statics/qrcode/scan-qr-abc.png' })
  const r = await whatsapp.loginQr()
  assert.equal(r.ok, true, JSON.stringify(r))
  if (r.ok) { assert.equal(r.dataUri, `data:image/png;base64,${PNG.toString('base64')}`); assert.equal(r.durationSec, 30) }
  const img = seen.find(s => s.path.startsWith('/statics/'))
  assert.ok(img, 'gambar tak diambil dari gateway'); assert.equal(img.headers.get('authorization'), AUTH)
})
await t('QR: jalur di luar statics/qrcode, bukan PNG, atau sudah terhubung → ditolak', async () => {
  for (const qrLink of ['http://x/etc/passwd', 'http://x/statics/qrcode/../../app/storages/whatsapp.db', 'http://x/statics/media/a.png', 'bukan-url']) {
    reset({ qrLink })
    assert.deepEqual(await whatsapp.loginQr(), { ok: false, reason: 'failed' }, qrLink)
    assert.ok(!seen.some(s => !['/app/status', '/app/login'].includes(s.path)), `mengambil ${qrLink}`)
  }
  reset({ qrBody: '<html>bukan png</html>' })
  assert.deepEqual(await whatsapp.loginQr(), { ok: false, reason: 'failed' })
  reset({ loggedIn: true, jid: '6281234567890@s.whatsapp.net' })
  assert.deepEqual(await whatsapp.loginQr(), { ok: false, reason: 'alreadyConnected' })
  assert.ok(!seen.some(s => s.path === '/app/login'), 'login dipanggil padahal sudah terhubung')
  reset(); delete env.WA_GATEWAY_URL
  assert.deepEqual(await whatsapp.loginQr(), { ok: false, reason: 'unconfigured' })
})
await t('kode pasangan: nomor digit diteruskan, kode dibentuk ketat; nomor tak sah tak dikirim', async () => {
  reset()
  assert.deepEqual(await whatsapp.loginWithCode('6281234567890'), { ok: true, code: 'ABCD-1234' })
  assert.equal(seen.find(s => s.path === '/app/login-with-code')?.query.get('phone'), '6281234567890')
  reset()
  assert.deepEqual(await whatsapp.loginWithCode('62812&x=1'), { ok: false, reason: 'failed' })
  assert.equal(seen.length, 0)
  reset({ pair: '<script>' })
  assert.deepEqual(await whatsapp.loginWithCode('6281234567890'), { ok: false, reason: 'failed' })
})
await t('putuskan / sambung ulang memanggil /app/logout & /app/reconnect', async () => {
  reset()
  assert.deepEqual(await whatsapp.logout(), { ok: true })
  assert.deepEqual(await whatsapp.reconnect(), { ok: true })
  assert.deepEqual(seen.map(s => s.path), ['/app/logout', '/app/reconnect'])
  env.WA_GATEWAY_PASSWORD = 'salah'
  assert.deepEqual(await whatsapp.logout(), { ok: false, reason: 'unauthorized' })
})

await gowa.stop()
console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
