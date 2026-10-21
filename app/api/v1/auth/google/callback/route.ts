import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { exchangeAndVerify, readStateCookie, signSignupCookie } from '@/lib/auth/google'
import { setSignupCookie, takeStateCookie } from '@/lib/auth/googleCookies'
import { resolveGoogleLogin } from '@/lib/auth/googleAccounts'
import { createSession } from '@/lib/auth/session'
import { appUrl } from '@/lib/email/templates'
import { clientIp, consume, policy } from '@/lib/auth/rateLimit'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = appUrl() || request.url

  // Cookie state dibuang SEKARANG, apa pun hasilnya (sekali pakai).
  const stateCookie = await readStateCookie(await takeStateCookie())
  const locale = stateCookie?.locale === 'en' ? 'en' : 'id'
  const go = (path: string) => NextResponse.redirect(new URL(`/${locale}${path}`, origin))
  const fail = (code: string) => go(`/login?error=${code}`)

  try {
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('googleIp', ip))
      if (!h.allowed) return fail('google_ratelimited')
    }

    if (url.searchParams.get('error')) return fail('google_denied') // pengguna menolak di layar Google
    const state = url.searchParams.get('state')
    const code = url.searchParams.get('code')
    // CSRF: state di URL harus sama dengan yang kita simpan di cookie browser yang memulai alur ini.
    if (!stateCookie || !state || !code || !same(state, stateCookie.state)) return fail('google_failed')

    const result = await exchangeAndVerify(code, stateCookie.verifier, stateCookie.nonce)
    if (!result.ok) return fail(result.reason === 'unverified_email' ? 'google_unverified' : result.reason === 'not_configured' ? 'google_unavailable' : 'google_failed')

    const resolved = await resolveGoogleLogin(result.identity)
    if (resolved.kind === 'refused') return fail(`google_${resolved.reason}`)
    if (resolved.kind === 'session') {
      await createSession({ userId: resolved.user.id, role: resolved.user.role })
      return go('/dashboard')
    }

    // Pengguna baru: identitas terverifikasi disimpan sementara; akun dibuat setelah persetujuan privasi (halaman lengkapi).
    await setSignupCookie(await signSignupCookie(result.identity))
    return go('/register/google')
  } catch (error) {
    console.error('[auth/google/callback]', error instanceof Error ? error.name : error)
    return fail('google_failed')
  }
}
