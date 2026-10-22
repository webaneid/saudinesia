// Evaluasi LOKAL tanpa kredensial asli: `bun run dev:eval` (docs/evaluasi-lokal.md).
// Menjalankan SIMULASI tiga layanan luar + aplikasi (next dev) dengan env yang sudah tersambung ke simulasi itu:
//   - Resend  (http://localhost:6299) : "kotak masuk" — semua email yang dikirim aplikasi muncul di sini, tautannya bisa diklik
//   - GOWA    (http://localhost:6297) : pesan WhatsApp keluar + SIMULATOR pesan masuk (mengirim webhook bertanda tangan HMAC sungguhan)
//   - Google  (http://localhost:6298) : pemilih akun palsu (alur OAuth + PKCE + ID token RSA sungguhan, tanpa Google)
// Hanya untuk development: rate limit dimatikan, tidak ada yang dikirim ke luar mesin ini. Env berlaku HANYA untuk proses aplikasi ini
// (.env.local tidak diubah). Tanpa dependency baru (node:http + jose).
import { spawn } from 'node:child_process'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

const APP_PORT = Number(process.env.EVAL_APP_PORT ?? 6260)
const APP_URL = `http://localhost:${APP_PORT}`
// Port simulasi bisa diganti (mis. menjalankan dua sesi berdampingan): EVAL_GOWA_PORT / EVAL_GOOGLE_PORT / EVAL_MAIL_PORT.
const PORT = { gowa: Number(process.env.EVAL_GOWA_PORT ?? 6297), google: Number(process.env.EVAL_GOOGLE_PORT ?? 6298), mail: Number(process.env.EVAL_MAIL_PORT ?? 6299) }
const WEBHOOK_SECRET = randomBytes(32).toString('hex') // acak per sesi; dipakai bersama oleh aplikasi dan GOWA palsu
const GOOGLE_CLIENT_ID = 'evaluasi-lokal.apps.googleusercontent.com'
const GOOGLE_CLIENT_SECRET = randomBytes(16).toString('hex')

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const time = (d: Date) => d.toLocaleTimeString('id-ID', { hour12: false })

const STYLE = `<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f4f1e8;color:#15241e}
  header{background:#04543e;color:#fff;padding:14px 20px;font-weight:700}
  header small{font-weight:400;opacity:.8;margin-left:8px}
  main{max-width:760px;margin:20px auto;padding:0 16px}
  .card{background:#fff;border:1px solid #e5e0d0;border-radius:10px;padding:14px 16px;margin:0 0 12px}
  .muted{color:#5c6a64;font-size:12px}
  a.btn,button{display:inline-block;background:#04543e;color:#fff;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
  button.ghost{background:#fff;color:#04543e;border:1px solid #04543e}
  input[type=text],input[type=email]{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cfc9b4;border-radius:8px;font:inherit}
  label{display:block;margin:8px 0 3px;font-weight:600}
  pre{white-space:pre-wrap;background:#f8f5ec;border-radius:8px;padding:10px;margin:8px 0 0;font-size:12px}
  code{background:#f8f5ec;padding:1px 5px;border-radius:4px}
</style>`
const page = (title: string, sub: string, body: string, refresh = 0) =>
  `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}${STYLE}</head><body><header>${esc(title)}<small>${esc(sub)}</small></header><main>${body}</main></body></html>`

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}
const send = (res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, ...headers })
  res.end(body)
}
const html = (res: ServerResponse, body: string) => send(res, 200, 'text/html', body)
const json = (res: ServerResponse, status: number, v: unknown) => send(res, status, 'application/json', JSON.stringify(v))
const redirect = (res: ServerResponse, to: string) => { res.writeHead(303, { location: to }); res.end() }
const form = (raw: string) => Object.fromEntries(new URLSearchParams(raw))

// ───────────── Resend palsu: kotak masuk ─────────────
type Mail = { id: string; at: Date; to: string; subject: string; text: string; html: string }
const inbox: Mail[] = []
const mail = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (req.method === 'POST' && url.pathname === '/emails') {
    const b = JSON.parse((await readBody(req)) || '{}') as { to?: string[]; subject?: string; text?: string; html?: string }
    const m: Mail = { id: randomUUID(), at: new Date(), to: (b.to ?? []).join(', '), subject: b.subject ?? '', text: b.text ?? '', html: b.html ?? '' }
    inbox.unshift(m)
    console.log(`[email] → ${m.to} | ${m.subject}`)
    return json(res, 200, { id: m.id })
  }
  const one = /^\/m\/([\w-]+)$/.exec(url.pathname)
  if (one) {
    const m = inbox.find((x) => x.id === one[1])
    return m ? send(res, 200, 'text/html', m.html) : send(res, 404, 'text/plain', 'tidak ada')
  }
  const items = inbox.map((m) => {
    const link = /https?:\/\/\S+/.exec(m.text)?.[0]
    return `<div class="card"><b>${esc(m.subject)}</b><div class="muted">Ke: ${esc(m.to)} · ${time(m.at)}</div>
      <div style="margin-top:8px">${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Buka tautan di email</a> ` : ''}<a class="btn" style="background:#fff;color:#04543e;border:1px solid #04543e" href="/m/${m.id}" target="_blank">Lihat tampilan email</a></div>
      <details><summary class="muted">Teks email</summary><pre>${esc(m.text)}</pre></details></div>`
  }).join('')
  html(res, page('Kotak masuk (simulasi Resend)', 'email yang dikirim aplikasi muncul di sini — halaman menyegarkan diri tiap 5 dtk', items || '<div class="card muted">Belum ada email. Daftar, lupa password, atau lakukan pemesanan di aplikasi.</div>', 5))
})

// ───────────── GOWA palsu: pesan keluar + simulator pesan masuk ─────────────
type Out = { at: Date; phone: string; message: string }
const outgoing: Out[] = []
let lastSimulation = ''
let lastFrom = '6281234567890' // formulir mengingat nomor terakhir yang dipakai
const gowa = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.pathname === '/app/status') return json(res, 200, { code: 'SUCCESS', message: 'simulasi', results: { is_connected: true, is_logged_in: true, device_id: 'simulasi' } })
  if (req.method === 'POST' && url.pathname === '/app/send/message/text') {
    const b = JSON.parse((await readBody(req)) || '{}') as { phone?: string; message?: string }
    outgoing.unshift({ at: new Date(), phone: b.phone ?? '', message: b.message ?? '' })
    console.log(`[whatsapp] → ${b.phone}: ${(b.message ?? '').split('\n')[0]}`)
    return json(res, 200, { code: 'SUCCESS' })
  }
  if (req.method === 'POST' && url.pathname === '/simulate') {
    const f = form(await readBody(req))
    const digits = (f.from ?? '').replace(/\D/g, '')
    lastFrom = digits || lastFrom
    const body = JSON.stringify({
      event: 'message', device_id: 'simulasi',
      payload: { id: randomUUID(), chat_id: `${digits}@s.whatsapp.net`, from: `${digits}@s.whatsapp.net`, sender_display_name: 'Simulasi', timestamp: new Date().toISOString(), is_from_me: false, body: f.body ?? '' },
    })
    const signature = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
    try {
      const r = await fetch(`${APP_URL}/api/v1/webhooks/whatsapp`, { method: 'POST', headers: { 'X-Hub-Signature-256': signature, 'content-type': 'application/json' }, body })
      lastSimulation = `Webhook → HTTP ${r.status} ${await r.text()}`
    } catch (e) {
      lastSimulation = `Webhook GAGAL dikirim ke aplikasi (${APP_URL}): ${(e as Error).message}`
    }
    return redirect(res, '/')
  }
  const rows = outgoing.map((m) => `<div class="card"><div class="muted">Ke +${esc(m.phone)} · ${time(m.at)}</div><pre>${esc(m.message)}</pre></div>`).join('')
  html(res, page('WhatsApp (simulasi GOWA)', 'pesan keluar aplikasi + simulator pesan masuk', `
    <div class="card"><b>Simulator pesan masuk</b><div class="muted">Meniru pengguna yang mengirim pesan ke nomor bisnis — dikirim ke webhook aplikasi dengan tanda tangan HMAC sungguhan.</div>
    <form method="post" action="/simulate"><label>Dari nomor (dengan kode negara, tanpa +)</label><input type="text" name="from" value="${esc(lastFrom)}">
    <label>Isi pesan</label><input type="text" name="body" value="VERIF "><div class="muted">Salin kode dari halaman Profil → Verifikasi WhatsApp, mis. <code>VERIF K7Q2M9XD</code>. Nomor pengirim harus sama dengan nomor WhatsApp akun.</div>
    <p><button type="submit">Kirim sebagai pengguna</button></p></form>${lastSimulation ? `<pre>${esc(lastSimulation)}</pre>` : ''}</div>
    <b>Pesan keluar dari aplikasi</b><div style="margin-top:8px">${rows || '<div class="card muted">Belum ada. Hanya nomor TERVERIFIKASI yang menerima WhatsApp — yang lain hanya email.</div>'}</div>`, 0))
})

// ───────────── Google palsu: pemilih akun + token RSA ─────────────
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'evaluasi', alg: 'RS256', use: 'sig' }
type Grant = { challenge: string; nonce: string; clientId: string; redirect: string; email: string; name: string; verified: boolean }
const grants = new Map<string, Grant>()
const google = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.pathname === '/jwks') return json(res, 200, { keys: [jwk] })

  if (req.method === 'GET' && url.pathname === '/auth') {
    const q = url.searchParams
    const hidden = ['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge'].map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k))}">`).join('')
    return html(res, page('Masuk dengan Google (simulasi)', 'pemilih akun palsu — tidak ada Google sungguhan', `
      <div class="card"><b>Pilih akun</b><form method="post" action="/pick">${hidden}
      <label>Email</label><input type="email" name="email" value="jamaah.google@example.test" required>
      <label>Nama</label><input type="text" name="name" value="Jamaah Google" required>
      <label style="font-weight:400"><input type="checkbox" name="verified" value="1" checked> Email terverifikasi oleh Google</label>
      <div class="muted">Hilangkan centang untuk menguji penolakan email yang belum terverifikasi.</div>
      <p><button type="submit" name="action" value="ok">Lanjutkan</button> <button class="ghost" type="submit" name="action" value="deny">Batal (tolak akses)</button></p></form></div>`))
  }
  if (req.method === 'POST' && url.pathname === '/pick') {
    const f = form(await readBody(req))
    const redirectUri = f.redirect_uri ?? ''
    if (f.action === 'deny') return redirect(res, `${redirectUri}?error=access_denied&state=${encodeURIComponent(f.state ?? '')}`)
    const code = randomBytes(16).toString('hex')
    grants.set(code, { challenge: f.code_challenge ?? '', nonce: f.nonce ?? '', clientId: f.client_id ?? '', redirect: redirectUri, email: f.email ?? '', name: f.name ?? '', verified: f.verified === '1' })
    return redirect(res, `${redirectUri}?code=${code}&state=${encodeURIComponent(f.state ?? '')}`)
  }
  if (req.method === 'POST' && url.pathname === '/token') {
    const f = form(await readBody(req))
    const g = grants.get(f.code ?? ''); grants.delete(f.code ?? '') // kode sekali pakai
    const pkceOk = !!g && createHash('sha256').update(f.code_verifier ?? '').digest('base64url') === g.challenge
    if (!g || !pkceOk || g.redirect !== f.redirect_uri || f.client_id !== g.clientId || f.client_secret !== GOOGLE_CLIENT_SECRET) return json(res, 400, { error: 'invalid_grant' })
    const now = Math.floor(Date.now() / 1000)
    const idToken = await new SignJWT({
      iss: 'https://accounts.google.com', aud: g.clientId, sub: `evaluasi-${createHash('sha256').update(g.email).digest('hex').slice(0, 16)}`,
      email: g.email, email_verified: g.verified, name: g.name, nonce: g.nonce, iat: now, exp: now + 3600,
    }).setProtectedHeader({ alg: 'RS256', kid: 'evaluasi' }).sign(privateKey)
    return json(res, 200, { id_token: idToken, access_token: 'evaluasi', token_type: 'Bearer' })
  }
  send(res, 404, 'text/plain', 'tidak ada')
})

// ───────────── jalankan semuanya ─────────────
function listen(server: ReturnType<typeof createServer>, port: number, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => reject(new Error(e.code === 'EADDRINUSE' ? `Port ${port} (${name}) sudah dipakai — hentikan proses lain atau tunggu sesi evaluasi sebelumnya berakhir.` : e.message)))
    server.listen(port, '127.0.0.1', resolve)
  })
}

try {
  await Promise.all([listen(mail, PORT.mail, 'kotak masuk email'), listen(gowa, PORT.gowa, 'GOWA'), listen(google, PORT.google, 'Google')])
} catch (e) {
  console.error('GAGAL:', (e as Error).message)
  process.exit(1)
}

const env = {
  ...process.env,
  // Aplikasi
  APP_URL, NEXT_PUBLIC_APP_URL: APP_URL, RATE_LIMIT_DISABLED: 'true', REDIS_URL: process.env.EVAL_KEEP_REDIS === '1' ? process.env.REDIS_URL ?? '' : '',
  // Email → kotak masuk simulasi
  RESEND_API_KEY: 're_evaluasi_lokal', RESEND_FROM: 'Saudinesia <noreply@saudinesia.test>', RESEND_API_URL: `http://127.0.0.1:${PORT.mail}`,
  // WhatsApp → GOWA simulasi; webhook memakai secret acak sesi ini
  WA_GATEWAY_URL: `http://127.0.0.1:${PORT.gowa}`, WA_GATEWAY_TOKEN: 'evaluasi', WHATSAPP_WEBHOOK_SECRET: WEBHOOK_SECRET,
  NEXT_PUBLIC_BUSINESS_WA: process.env.NEXT_PUBLIC_BUSINESS_WA || '628111222333',
  // Google → pemilih akun simulasi
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  // 127.0.0.1 (BUKAN localhost) = situs berbeda dari aplikasi di localhost → navigasi balik dari 'Google' bersifat LINTAS-SITUS seperti Google asli;
  // di localhost yang sama, masalah cookie SameSite tidak akan pernah muncul.
  GOOGLE_AUTH_URL: `http://127.0.0.1:${PORT.google}/auth`, GOOGLE_TOKEN_URL: `http://127.0.0.1:${PORT.google}/token`, GOOGLE_JWKS_URL: `http://127.0.0.1:${PORT.google}/jwks`,
}

console.log(`
═══════════════════════════════════════════════════════════════
 Saudinesia — MODE EVALUASI LOKAL (semua layanan luar disimulasikan)
═══════════════════════════════════════════════════════════════
 Aplikasi           ${APP_URL}
 Kotak masuk email  http://localhost:${PORT.mail}   ← buka di tab terpisah (tautan daftar/reset ada di sini)
 WhatsApp (GOWA)    http://localhost:${PORT.gowa}   ← pesan keluar + simulator pesan masuk (verifikasi nomor)
 Google             pemilih akun palsu (http://127.0.0.1:${PORT.google}, situs berbeda seperti Google asli) muncul saat menekan "Masuk dengan Google"
 Rate limit dimatikan. Tekan Ctrl+C untuk berhenti. Panduan: docs/evaluasi-lokal.md
═══════════════════════════════════════════════════════════════
`)

const app = spawn('bunx', ['next', 'dev', '--turbopack', '-p', String(APP_PORT)], { env, stdio: 'inherit' })
const stop = () => { app.kill('SIGTERM'); mail.close(); gowa.close(); google.close() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
app.on('exit', (code) => { mail.close(); gowa.close(); google.close(); process.exit(code ?? 0) })
