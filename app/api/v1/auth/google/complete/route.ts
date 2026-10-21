import { NextResponse } from 'next/server'
import { readSignupCookie } from '@/lib/auth/google'
import { clearSignupCookie, readSignupCookieValue } from '@/lib/auth/googleCookies'
import { createGoogleAccount } from '@/lib/auth/googleAccounts'
import { createSession } from '@/lib/auth/session'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { googleCompleteSchema } from '@/lib/validators/auth'
import { notify } from '@/lib/notifications/notify'
import { ok, err } from '@/lib/validators'

// Pengguna Google baru menyetujui kebijakan privasi → akun dibuat → masuk.
export async function POST(request: Request) {
  try {
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('googleIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }
    const parsed = googleCompleteSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })

    const identity = await readSignupCookie(await readSignupCookieValue())
    if (!identity) return NextResponse.json(err('Sesi pendaftaran Google berakhir. Mulai lagi dari tombol Google.'), { status: 401 })

    const result = await createGoogleAccount(identity, parsed.data.fullName)
    if (!result.ok) return NextResponse.json(err('Akun dengan email ini sudah ada. Silakan masuk.'), { status: 409 })

    await clearSignupCookie()
    await createSession({ userId: result.user.id, role: result.user.role })
    void notify({ userId: result.user.id, event: { type: 'welcome', name: result.user.fullName }, dedupe: true })
    return NextResponse.json(ok({ role: result.user.role }))
  } catch (error) {
    console.error('[auth/google/complete]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
