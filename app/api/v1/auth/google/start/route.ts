import { NextResponse } from 'next/server'
import { buildAuthUrl, newAuthRequest, signStateCookie } from '@/lib/auth/google'
import { setStateCookie } from '@/lib/auth/googleCookies'
import { appUrl } from '@/lib/email/templates'
import { clientIp, consume, policy } from '@/lib/auth/rateLimit'

// Awal login Google: buat state + nonce + PKCE, simpan di cookie bertanda tangan, alihkan ke Google.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'id' // allow-list: parameter tak pernah dipakai mentah di redirect
  const back = (code: string) => NextResponse.redirect(new URL(`/${locale}/login?error=${code}`, appUrl() || request.url))

  const ip = clientIp(request)
  if (ip) {
    const h = await consume(policy('googleIp', ip))
    if (!h.allowed) return back('google_ratelimited') // navigasi tingkat-atas: tampilkan pesan di halaman, bukan JSON mentah
  }

  const req = newAuthRequest()
  const authUrl = buildAuthUrl(req)
  if (!authUrl) return back('google_unavailable') // kredensial belum diisi → fitur mati

  await setStateCookie(await signStateCookie({ state: req.state, nonce: req.nonce, verifier: req.verifier, locale }))
  return NextResponse.redirect(authUrl)
}
