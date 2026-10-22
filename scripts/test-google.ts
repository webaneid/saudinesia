// Uji login Google (docs/arsitektur-auth.md §3.3–3.4): protokol (lib/auth/google.ts) terhadap server Google PALSU dengan kunci RSA nyata,
// dan aturan akun (lib/auth/googleAccounts.ts) terhadap DATABASE sungguhan. Tidak ada jaringan nyata.
//
// PENGAMAN: menulis user sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { compare } from 'bcryptjs'
import { SignJWT, exportJWK, generateKeyPair, jwtVerify, type KeyLike } from 'jose'
import { prisma } from '@/lib/db'
import {
  buildAuthUrl, exchangeAndVerify, googleConfigured, googleEndpoints, newAuthRequest, readSignupCookie, readStateCookie, signSignupCookie, signStateCookie,
} from '@/lib/auth/google'
import { createGoogleAccount, resolveGoogleLogin } from '@/lib/auth/googleAccounts'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 5).join('\n     ')}`)
  }
}
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'test'
env.JWT_SECRET = randomBytes(32).toString('hex') // acak per proses: tak ada literal serupa kunci di repo (gitleaks)
env.APP_URL = 'https://saudinesia.test'
env.GOOGLE_CLIENT_ID = 'client-id-uji.apps.googleusercontent.com'
env.GOOGLE_CLIENT_SECRET = 'rahasia-client-uji'

// ───────────── Google palsu ─────────────
const good = await generateKeyPair('RS256')
const other = await generateKeyPair('RS256')
const rs384 = await generateKeyPair('RS384') // kunci RSA yang sah untuk RS384 (uji pembatasan algoritma)
const jwk = { ...(await exportJWK(good.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const jwk384 = { ...(await exportJWK(rs384.publicKey)), kid: 'k384', use: 'sig' } // sengaja TANPA alg

type Claims = Record<string, unknown>
let tokenClaims: Claims | null = null            // klaim yang akan ditandatangani untuk /token berikutnya
let signWith: KeyLike | Uint8Array = good.privateKey
let signAlg = 'RS256'
let tokenStatus = 200
let omitIdToken = false
let lastTokenRequest: Record<string, string> = {}
let echoNonce = '' // Google mengembalikan nonce dari permintaan otorisasi di dalam ID token
// /token menerima body form-encoded (fakeServer hanya JSON) → node:http langsung.
const tokenServer = createServer((req, res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', async () => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (path === '/jwks') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); return }
    if (path === '/jwks-noalg') { const { alg: _alg, ...noAlg } = jwk; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [noAlg, jwk384] })); return }
    if (path === '/token') {
      lastTokenRequest = Object.fromEntries(new URLSearchParams(b))
      if (tokenStatus !== 200) { res.writeHead(tokenStatus, { 'content-type': 'application/json' }); res.end('{"error":"invalid_grant"}'); return }
      if (omitIdToken) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"access_token":"x"}'); return }
      const now = Math.floor(Date.now() / 1000)
      const claims: Claims = { iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, sub: 'sub-1', email: 'budi@example.test', email_verified: true, name: 'Budi Santoso', nonce: echoNonce, iat: now, exp: now + 3600, ...tokenClaims }
      for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k]
      const jwt = await new SignJWT(claims).setProtectedHeader({ alg: signAlg, kid: signAlg === 'RS384' ? 'k384' : 'k1' }).sign(signWith)
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id_token: jwt, access_token: 'x' }))
      return
    }
    res.writeHead(404); res.end()
  })
})
await new Promise<void>((r) => tokenServer.listen(0, '127.0.0.1', r))
const port = (tokenServer.address() as { port: number }).port
env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${port}/token`
env.GOOGLE_JWKS_URL = `http://127.0.0.1:${port}/jwks`
env.GOOGLE_AUTH_URL = `http://127.0.0.1:${port}/auth`

function scenario(claims: Claims | null = null, opts: { signer?: KeyLike | Uint8Array; alg?: string; status?: number; omit?: boolean } = {}) {
  tokenClaims = claims; signWith = opts.signer ?? good.privateKey; signAlg = opts.alg ?? 'RS256'; tokenStatus = opts.status ?? 200; omitIdToken = opts.omit ?? false
}
const req = newAuthRequest()
echoNonce = req.nonce
const verify = (nonce = req.nonce) => exchangeAndVerify('kode-uji', req.verifier, nonce)

console.log('== protokol ==')

await t('buildAuthUrl: client_id, redirect_uri persis, scope, state, nonce, PKCE S256 + challenge = SHA-256(verifier)', async () => {
  const u = new URL(buildAuthUrl(req)!)
  assert.equal(u.searchParams.get('client_id'), env.GOOGLE_CLIENT_ID)
  assert.equal(u.searchParams.get('redirect_uri'), 'https://saudinesia.test/api/v1/auth/google/callback')
  assert.equal(u.searchParams.get('response_type'), 'code')
  assert.equal(u.searchParams.get('scope'), 'openid email profile')
  assert.equal(u.searchParams.get('state'), req.state)
  assert.equal(u.searchParams.get('nonce'), req.nonce)
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update(req.verifier).digest('base64url'))
  assert.notEqual(newAuthRequest().state, req.state) // acak per percobaan
})

await t('tanpa kredensial → buildAuthUrl null dan exchange not_configured (fitur mati)', async () => {
  const id = env.GOOGLE_CLIENT_ID; delete env.GOOGLE_CLIENT_ID
  assert.equal(buildAuthUrl(req), null)
  assert.deepEqual(await verify(), { ok: false, reason: 'not_configured' })
  env.GOOGLE_CLIENT_ID = id
})

await t('override endpoint HANYA di development/test: production mengabaikannya (tetap ke Google asli)', async () => {
  env.NODE_ENV = 'production'
  assert.ok(buildAuthUrl(req)!.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'))
  env.NODE_ENV = 'staging'
  assert.ok(buildAuthUrl(req)!.startsWith('https://accounts.google.com/'))
  env.NODE_ENV = ''
  assert.ok(buildAuthUrl(req)!.startsWith('https://accounts.google.com/'))
  env.NODE_ENV = 'test'
  assert.ok(buildAuthUrl(req)!.startsWith(`http://127.0.0.1:${port}/auth?`))
})

await t('sukses: identitas terverifikasi (email huruf kecil), permintaan token membawa PKCE verifier, secret, redirect_uri persis', async () => {
  scenario({ email: 'Budi.Santoso@Example.TEST' })
  const r = await verify()
  assert.deepEqual(r, { ok: true, identity: { sub: 'sub-1', email: 'budi.santoso@example.test', name: 'Budi Santoso' } })
  assert.equal(lastTokenRequest.code, 'kode-uji')
  assert.equal(lastTokenRequest.code_verifier, req.verifier)
  assert.equal(lastTokenRequest.client_secret, env.GOOGLE_CLIENT_SECRET)
  assert.equal(lastTokenRequest.redirect_uri, 'https://saudinesia.test/api/v1/auth/google/callback')
  assert.equal(lastTokenRequest.grant_type, 'authorization_code')
})

await t('nama kosong → dipakai bagian lokal email', async () => {
  scenario({ name: undefined })
  const r = await verify()
  assert.equal(r.ok && r.identity.name, 'budi')
})

const rejects: Array<[string, Claims | null, Parameters<typeof scenario>[1], string, string?]> = [
  ['nonce salah (replay ID token)', null, undefined, 'invalid_token', 'nonce-lain'],
  ['audience salah (token milik aplikasi lain)', { aud: 'client-lain' }, undefined, 'invalid_token'],
  ['issuer salah', { iss: 'https://evil.example' }, undefined, 'invalid_token'],
  ['token kedaluwarsa', { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 }, undefined, 'invalid_token'],
  ['ditandatangani kunci LAIN (pemalsuan)', null, { signer: other.privateKey }, 'invalid_token'],
  ['tanpa sub', { sub: undefined }, undefined, 'invalid_token'],
  ['tanpa exp (token tak pernah kedaluwarsa)', { exp: undefined }, undefined, 'invalid_token'],
  ['tanpa iat', { iat: undefined }, undefined, 'invalid_token'],
  ['tanpa email', { email: undefined }, undefined, 'invalid_token'],
  ['email_verified = false', { email_verified: false }, undefined, 'unverified_email'],
  ['email_verified bukan boolean true ("true" string)', { email_verified: 'true' }, undefined, 'unverified_email'],
  ['tanpa email_verified', { email_verified: undefined }, undefined, 'unverified_email'],
  ['endpoint token menolak (invalid_grant)', null, { status: 400 }, 'token_exchange'],
  ['respons token tanpa id_token', null, { omit: true }, 'token_exchange'],
]
for (const [name, claims, opts, reason, nonce] of rejects) {
  await t(`ditolak (${reason}): ${name}`, async () => {
    scenario(null)
    assert.equal((await verify()).ok, true, 'kontrol positif: token bersih harus lolos, kalau tidak uji ini hampa')
    scenario(claims, opts)
    assert.deepEqual(await verify(nonce), { ok: false, reason: reason as never })
  })
}

await t('ditolak: ID token HS256 dipalsukan memakai material kunci publik (serangan konfusi algoritma)', async () => {
  scenario(null, { signer: new TextEncoder().encode(JSON.stringify(jwk)), alg: 'HS256' })
  assert.deepEqual(await verify(), { ok: false, reason: 'invalid_token' })
})

await t('ditolak: ID token RS384 (kunci sama) — opsi algorithms harus membatasi, bukan hanya cocok-tidaknya kunci di JWKS', async () => {
  // JWKS TANPA field alg: tanpa pembatasan `algorithms: ['RS256']` jose akan menerima RS384 dari kunci RSA yang sama
  const keep = env.GOOGLE_JWKS_URL; env.GOOGLE_JWKS_URL = `http://127.0.0.1:${port}/jwks-noalg`
  scenario(null, { alg: 'RS256' })
  assert.equal((await verify()).ok, true, 'kontrol positif (RS256, JWKS tanpa alg)')
  scenario(null, { alg: 'RS384', signer: rs384.privateKey })
  const r384 = await verify()
  assert.deepEqual(r384, { ok: false, reason: 'invalid_token' }, JSON.stringify(r384))
  env.GOOGLE_JWKS_URL = keep
})

await t('endpoint token tidak terjangkau → token_exchange (tidak melempar, tidak menggantung)', async () => {
  const keep = env.GOOGLE_TOKEN_URL; env.GOOGLE_TOKEN_URL = 'http://127.0.0.1:1/token'
  scenario()
  assert.deepEqual(await verify(), { ok: false, reason: 'token_exchange' })
  env.GOOGLE_TOKEN_URL = keep
})

await t('override token/JWKS/issuer/auth DIABAIKAN di luar development/test (fail-closed), bukan hanya buildAuthUrl', async () => {
  env.GOOGLE_ISSUER = 'https://evil.example'
  for (const nodeEnv of ['production', 'staging', '']) {
    env.NODE_ENV = nodeEnv
    const ep = googleEndpoints()
    assert.equal(ep.token, 'https://oauth2.googleapis.com/token', nodeEnv)
    assert.equal(ep.jwks, 'https://www.googleapis.com/oauth2/v3/certs', nodeEnv)
    assert.equal(ep.auth, 'https://accounts.google.com/o/oauth2/v2/auth', nodeEnv)
    assert.deepEqual(ep.issuers, ['https://accounts.google.com', 'accounts.google.com'], nodeEnv)
  }
  env.NODE_ENV = 'test'
  assert.equal(googleEndpoints().token, env.GOOGLE_TOKEN_URL) // kontrol positif: di test override dihormati
  assert.deepEqual(googleEndpoints().issuers, ['https://evil.example'])
  delete env.GOOGLE_ISSUER
})

await t('googleConfigured butuh kredensial DAN APP_URL (tanpa origin publik tombol tak boleh tampil)', async () => {
  assert.equal(googleConfigured(), true)
  const app = env.APP_URL; delete env.APP_URL; delete env.NEXT_PUBLIC_APP_URL // Bun memuat .env.local otomatis
  assert.equal(googleConfigured(), false)
  env.APP_URL = app
  const secret = env.GOOGLE_CLIENT_SECRET; delete env.GOOGLE_CLIENT_SECRET
  assert.equal(googleConfigured(), false)
  env.GOOGLE_CLIENT_SECRET = secret
})

console.log('== cookie sementara ==')

await t('cookie state: roundtrip; dirusak / kedaluwarsa / dibuat dengan rahasia lain ditolak', async () => {
  const c = { state: 's', nonce: 'n', verifier: 'v', locale: 'id' }
  const tok = await signStateCookie(c)
  assert.deepEqual(await readStateCookie(tok), c)
  assert.equal(await readStateCookie(tok.slice(0, -3) + 'abc'), null)
  assert.equal(await readStateCookie(undefined), null)
  assert.equal(await readStateCookie('bukan.jwt.sama-sekali'), null)
  const keep = env.JWT_SECRET; env.JWT_SECRET = randomBytes(32).toString('hex')
  assert.equal(await readStateCookie(tok), null)
  env.JWT_SECRET = keep
})

await t('cookie kedaluwarsa: TTL produksi tepat 10 menit (state) dan 15 menit (signup); yang lewat batas ditolak', async () => {
  const ttl = (jwt: string) => { const p = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as { exp: number; iat: number }; return p.exp - p.iat }
  assert.equal(ttl(await signStateCookie({ state: 's', nonce: 'n', verifier: 'v', locale: 'id' })), 600)
  assert.equal(ttl(await signSignupCookie({ sub: 'x', email: 'a@b.co', name: 'A' })), 900)
  // kontrol positif + kedaluwarsa nyata: ttl 2 detik, lalu tunggu. (exp/iat dibulatkan ke detik: ttl 1s bisa sudah lewat begitu dibuat bila melintasi batas detik → flaky di CI)
  const s = await signStateCookie({ state: 's', nonce: 'n', verifier: 'v', locale: 'id' }, '2s')
  const g = await signSignupCookie({ sub: 'x', email: 'a@b.co', name: 'A' }, '2s')
  assert.ok(await readStateCookie(s)); assert.ok(await readSignupCookie(g))
  await new Promise((r) => setTimeout(r, 3200))
  assert.equal(await readStateCookie(s), null); assert.equal(await readSignupCookie(g), null)
})

await t('TIDAK bisa ditukar: cookie state ≠ cookie signup ≠ JWT sesi (kunci & audience berbeda)', async () => {
  const stateTok = await signStateCookie({ state: 's', nonce: 'n', verifier: 'v', locale: 'id' })
  const signupTok = await signSignupCookie({ sub: 'x', email: 'a@b.co', name: 'A' })
  assert.equal(await readSignupCookie(stateTok), null)
  assert.equal(await readStateCookie(signupTok), null)
  // JWT sesi (JWT_SECRET mentah) tak berlaku sebagai cookie Google, dan sebaliknya cookie Google tak lolos sebagai sesi
  const session = await new SignJWT({ userId: 'u', role: 'superadmin' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET!))
  assert.equal(await readStateCookie(session), null)
  assert.equal(await readSignupCookie(session), null)
  await assert.rejects(jwtVerify(signupTok, new TextEncoder().encode(env.JWT_SECRET!)))
  await assert.rejects(jwtVerify(stateTok, new TextEncoder().encode(env.JWT_SECRET!)))
})

console.log('== aturan akun ==')

const tag = `gt${Date.now()}`
let n = 0
const email = () => `${tag}-${++n}@example.test`
const id = (e: string, sub = `sub-${tag}-${n}`) => ({ sub, email: e, name: 'Tamu Google' })
const mk = (e: string, extra: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { email: e, passwordHash: '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012', fullName: 'Ada', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(), ...extra } })

await t('pengguna baru → new; setelah menyetujui, akun dibuat (terverifikasi, googleSub, ConsentLog, password tak bisa ditebak)', async () => {
  const e = email(); const identity = id(e)
  assert.deepEqual(await resolveGoogleLogin(identity), { kind: 'new' })
  assert.equal(await prisma.user.count({ where: { email: e } }), 0) // belum ada akun sebelum persetujuan
  const r = await createGoogleAccount(identity, 'Tamu Google')
  assert.equal(r.ok, true)
  const u = await prisma.user.findUniqueOrThrow({ where: { email: e }, include: { consentLogs: true } })
  assert.equal(u.googleSub, identity.sub); assert.equal(u.role, 'pilgrim'); assert.ok(u.emailVerifiedAt)
  assert.equal(u.phone, null); assert.equal(u.whatsapp, null)
  assert.deepEqual(u.consentLogs.map((c) => c.type), ['privacy_policy'])
  for (const guess of ['', 'password', 'Admin@1234', e]) assert.equal(await compare(guess, u.passwordHash), false)
})

await t('masuk berikutnya lewat sub — tetap benar walau email di Google berubah', async () => {
  const e = email(); const identity = id(e); await createGoogleAccount(identity, 'X')
  const r = await resolveGoogleLogin({ ...identity, email: 'email-baru@example.test' })
  assert.equal(r.kind, 'session')
  assert.equal(await prisma.user.count({ where: { email: 'email-baru@example.test' } }), 0) // tidak membuat akun ganda
})

await t('akun manual (email terverifikasi) + Google dengan email sama → TERSAMBUNG otomatis; password lama tetap berlaku', async () => {
  const e = email(); const hashed = await (await import('bcryptjs')).hash('Sandi-Lama1!', 4)
  const u = await mk(e, { passwordHash: hashed })
  const identity = id(e)
  assert.deepEqual(await resolveGoogleLogin(identity), { kind: 'session', user: { id: u.id, role: 'pilgrim' } })
  const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  assert.equal(after.googleSub, identity.sub)
  assert.equal(await compare('Sandi-Lama1!', after.passwordHash), true)
})

await t('akun LAMA belum terverifikasi → tersambung, email ditandai terverifikasi, password lama DIMATIKAN (anti-pre-hijacking)', async () => {
  const e = email(); const hashed = await (await import('bcryptjs')).hash('Sandi-Penyerang1!', 4)
  const u = await mk(e, { passwordHash: hashed, emailVerifiedAt: null })
  assert.equal((await resolveGoogleLogin(id(e))).kind, 'session')
  const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  assert.ok(after.emailVerifiedAt)
  assert.equal(await compare('Sandi-Penyerang1!', after.passwordHash), false)
})

await t('STAF tidak pernah tersambung: admin/manager/superadmin dengan email sama → refused staff, googleSub tetap kosong', async () => {
  for (const role of ['admin', 'manager', 'superadmin'] as const) {
    const e = email(); const u = await mk(e, { role })
    assert.deepEqual(await resolveGoogleLogin(id(e)), { kind: 'refused', reason: 'staff' }, role)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).googleSub, null)
  }
  // defensif: staf yang entah bagaimana punya googleSub juga ditolak
  const e = email(); const identity = id(e); await mk(e, { role: 'admin', googleSub: identity.sub })
  assert.deepEqual(await resolveGoogleLogin(identity), { kind: 'refused', reason: 'staff' })
})

await t('akun dinonaktifkan ditolak (lewat email maupun sub); tidak disambung', async () => {
  const e = email(); const u = await mk(e, { isActive: false })
  assert.deepEqual(await resolveGoogleLogin(id(e)), { kind: 'refused', reason: 'inactive' })
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).googleSub, null)
  const e2 = email(); const i2 = id(e2); await mk(e2, { isActive: false, googleSub: i2.sub })
  assert.deepEqual(await resolveGoogleLogin(i2), { kind: 'refused', reason: 'inactive' })
})

await t('konflik: email sudah tersambung ke akun Google LAIN → refused conflict, tidak ada perubahan', async () => {
  const e = email(); const u = await mk(e, { googleSub: 'sub-pemilik-asli' })
  assert.deepEqual(await resolveGoogleLogin({ sub: 'sub-orang-lain', email: e, name: 'X' }), { kind: 'refused', reason: 'conflict' })
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).googleSub, 'sub-pemilik-asli')
})

await t('balapan: dua Google berbeda menyambung email yang sama bersamaan → tepat satu menang, satunya conflict', async () => {
  const e = email(); const u = await mk(e)
  const rs = await Promise.all([resolveGoogleLogin({ sub: 'sub-A', email: e, name: 'A' }), resolveGoogleLogin({ sub: 'sub-B', email: e, name: 'B' })])
  assert.equal(rs.filter((r) => r.kind === 'session').length, 1)
  assert.equal(rs.filter((r) => r.kind === 'refused').length, 1)
  const sub = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).googleSub
  assert.ok(sub === 'sub-A' || sub === 'sub-B')
})

await t('createGoogleAccount untuk email yang sudah ada → exists (akun orang lain tidak tertimpa)', async () => {
  const e = email(); await mk(e, { fullName: 'Duluan' })
  assert.deepEqual(await createGoogleAccount(id(e), 'Penyusup'), { ok: false, reason: 'exists' })
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: e } })).fullName, 'Duluan')
})

tokenServer.close(); tokenServer.closeAllConnections()
await prisma.consentLog.deleteMany({ where: { user: { email: { startsWith: tag } } } })
await prisma.user.deleteMany({ where: { OR: [{ email: { startsWith: tag } }, { googleSub: { startsWith: 'sub-' } }] } })
await prisma.$disconnect()
console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
