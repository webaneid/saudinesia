import { NextResponse } from 'next/server'
import { completeRegistration } from '@/lib/auth/accounts'
import { createSession } from '@/lib/auth/session'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { completeRegistrationSchema } from '@/lib/validators/auth'
import { notify } from '@/lib/notifications/notify'
import { ok } from '@/lib/validators'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'

// Pemilik email memilih password → akun dibuat (email terverifikasi) → langsung masuk.
export async function POST(request: Request) {
  try {
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('authTokenIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }
    const parsed = completeRegistrationSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return zodFailure(parsed.error)

    const result = await completeRegistration(parsed.data.token, parsed.data.password)
    if (!result.ok) {
      return result.reason === 'exists'
        ? apiErrorJson('accountExists', 409)
        : apiErrorJson('linkInvalidRegister', 401)
    }

    await createSession(result.user.id)
    void notify({ userId: result.user.id, event: { type: 'welcome', name: result.user.fullName }, dedupe: true })
    return NextResponse.json(ok({ role: result.user.role }))
  } catch (error) {
    console.error('[auth/registration/complete]', error instanceof Error ? error.name : error)
    return apiErrorJson('internal', 500)
  }
}
