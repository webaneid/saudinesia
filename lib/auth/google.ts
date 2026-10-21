import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { appUrl } from '@/lib/email/templates'

// Login Google: OAuth 2.0 Authorization Code + PKCE buatan sendiri (tanpa Better Auth) — docs/arsitektur-auth.md §3.4.
// File ini hanya protokol (tanpa DB/sesi) supaya bisa diuji dengan server Google palsu.

const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
}

/** Override endpoint (uji dengan server palsu) HANYA di development/test — fail-closed (SEC-02). */
export function googleEndpoints() {
  const allow = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
  const o = (name: string, fallback: string) => (allow && process.env[name]?.trim()) || fallback
  const fakeIssuer = allow && process.env.GOOGLE_ISSUER?.trim()
  return {
    auth: o('GOOGLE_AUTH_URL', GOOGLE.auth),
    token: o('GOOGLE_TOKEN_URL', GOOGLE.token),
    jwks: o('GOOGLE_JWKS_URL', GOOGLE.jwks),
    issuers: fakeIssuer ? [fakeIssuer] : GOOGLE.issuers,
  }
}

/** URI yang HARUS didaftarkan persis di Google Cloud Console. Null bila origin publik belum diketahui. */
export function googleRedirectUri(): string | null {
  const base = appUrl()
  return base ? `${base}/api/v1/auth/google/callback` : null
}

/** Aktif hanya bila kredensial DAN origin publik (redirect URI) ada — tanpa APP_URL tombol akan tampil tetapi tak bisa bekerja. */
export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && googleRedirectUri())
}

// ───────────── cookie bertanda tangan (state sementara) ─────────────
// Kunci TURUNAN, bukan JWT_SECRET mentah: JWT sesi (`snd-session`) diverifikasi dengan JWT_SECRET — token yang ditandatangani
// dengan kunci yang sama bisa ditukar-pakai sebagai sesi. Kunci turunan + audience berbeda menutup itu.

function key(label: string): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return createHash('sha256').update(`${label}:${secret}`).digest()
}

export const STATE_COOKIE = 'snd-g-state'
export const SIGNUP_COOKIE = 'snd-g-new'

type StateClaims = { state: string; nonce: string; verifier: string; locale: string }
export type GoogleIdentity = { sub: string; email: string; name: string }

async function sign(label: string, claims: Record<string, unknown>, ttl: string): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setAudience(label).setIssuedAt().setExpirationTime(ttl).sign(key(label))
}

async function verify(label: string, token: string | undefined): Promise<JWTPayload | null> {
  if (!token) return null
  try {
    return (await jwtVerify(token, key(label), { audience: label })).payload
  } catch {
    return null
  }
}

/** `ttl` hanya untuk uji kedaluwarsa; produksi selalu memakai bawaan. */
export const signStateCookie = (c: StateClaims, ttl = '10m') => sign('google-oauth-state', c, ttl)
export async function readStateCookie(token: string | undefined): Promise<StateClaims | null> {
  const p = await verify('google-oauth-state', token)
  return p && typeof p.state === 'string' && typeof p.nonce === 'string' && typeof p.verifier === 'string' && typeof p.locale === 'string'
    ? { state: p.state, nonce: p.nonce, verifier: p.verifier, locale: p.locale }
    : null
}

export const signSignupCookie = (i: GoogleIdentity, ttl = '15m') => sign('google-signup', { ...i }, ttl)
export async function readSignupCookie(token: string | undefined): Promise<GoogleIdentity | null> {
  const p = await verify('google-signup', token)
  return p && typeof p.sub === 'string' && typeof p.email === 'string' && typeof p.name === 'string' ? { sub: p.sub, email: p.email, name: p.name } : null
}

// ───────────── langkah protokol ─────────────

const b64url = (b: Buffer) => b.toString('base64url')

/** Pasangan acak untuk satu percobaan login: state (CSRF), nonce (replay ID token), verifier PKCE + challenge S256-nya. */
export function newAuthRequest() {
  const verifier = b64url(randomBytes(32))
  return {
    state: b64url(randomBytes(24)),
    nonce: b64url(randomBytes(24)),
    verifier,
    challenge: b64url(createHash('sha256').update(verifier).digest()),
  }
}

export function buildAuthUrl(req: { state: string; nonce: string; challenge: string }): string | null {
  const redirectUri = googleRedirectUri()
  if (!googleConfigured() || !redirectUri) return null
  const u = new URL(googleEndpoints().auth)
  u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!.trim())
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'openid email profile')
  u.searchParams.set('state', req.state)
  u.searchParams.set('nonce', req.nonce)
  u.searchParams.set('code_challenge', req.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('prompt', 'select_account')
  return u.toString()
}

export type GoogleFailure = 'not_configured' | 'token_exchange' | 'invalid_token' | 'unverified_email'

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
function jwks(url: string) {
  let s = jwksCache.get(url)
  if (!s) { s = createRemoteJWKSet(new URL(url)); jwksCache.set(url, s) }
  return s
}

/**
 * Tukar `code` → ID token lalu VERIFIKASI penuh: tanda tangan (JWKS Google), iss, aud == client id, exp, nonce, sub, email,
 * email_verified == true. Tidak ada klaim yang dipercaya sebelum verifikasi tanda tangan.
 */
export async function exchangeAndVerify(code: string, verifier: string, nonce: string): Promise<{ ok: true; identity: GoogleIdentity } | { ok: false; reason: GoogleFailure }> {
  const redirectUri = googleRedirectUri()
  if (!googleConfigured() || !redirectUri) return { ok: false, reason: 'not_configured' }
  const ep = googleEndpoints()
  const clientId = process.env.GOOGLE_CLIENT_ID!.trim()

  let idToken: string
  try {
    const res = await fetch(ep.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
        redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { ok: false, reason: 'token_exchange' }
    const json = (await res.json().catch(() => null)) as { id_token?: unknown } | null
    if (typeof json?.id_token !== 'string') return { ok: false, reason: 'token_exchange' }
    idToken = json.id_token
  } catch {
    return { ok: false, reason: 'token_exchange' }
  }

  let claims: JWTPayload
  try {
    claims = (await jwtVerify(idToken, jwks(ep.jwks), { issuer: ep.issuers, audience: clientId, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub'] })).payload
  } catch {
    return { ok: false, reason: 'invalid_token' }
  }
  if (claims.nonce !== nonce) return { ok: false, reason: 'invalid_token' }
  if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !claims.email) return { ok: false, reason: 'invalid_token' }
  if (claims.email_verified !== true) return { ok: false, reason: 'unverified_email' }

  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : claims.email.split('@')[0] ?? ''
  return { ok: true, identity: { sub: claims.sub, email: claims.email.trim().toLowerCase(), name } }
}
