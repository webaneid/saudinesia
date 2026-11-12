import { NextResponse } from 'next/server'
import { readSignupCookie } from '@/lib/auth/google'
import { clearSignupCookie, readSignupCookieValue } from '@/lib/auth/googleCookies'
import { createGoogleAccount } from '@/lib/auth/googleAccounts'
import { createSession } from '@/lib/auth/session'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { googleCompleteSchema } from '@/lib/validators/auth'
import { notify } from '@/lib/notifications/notify'
import { ok } from '@/lib/validators'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'

// Pengguna Google baru menyetujui kebijakan privasi → akun dibuat → masuk.
export async function POST(request: Request) {
  try {
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('googleIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }
    const parsed = googleCompleteSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return zodFailure(parsed.error)

    const identity = await readSignupCookie(await readSignupCookieValue())
    if (!identity) return apiErrorJson('googleSessionExpired', 401)

    const result = await createGoogleAccount(identity, parsed.data.fullName)
    if (!result.ok) return apiErrorJson('accountExists', 409)

    await clearSignupCookie()
    await createSession(result.user.id)
    void notify({ userId: result.user.id, event: { type: 'welcome', name: result.user.fullName }, dedupe: true })
    return NextResponse.json(ok({ role: result.user.role }))
  } catch (error) {
    console.error('[auth/google/complete]', error instanceof Error ? error.name : error)
    return apiErrorJson('internal', 500)
  }
}
