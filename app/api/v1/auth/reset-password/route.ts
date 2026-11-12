import { NextResponse } from 'next/server'
import { resetPassword } from '@/lib/auth/accounts'
import { createSession } from '@/lib/auth/session'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { resetPasswordSchema } from '@/lib/validators/auth'
import { ok } from '@/lib/validators'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'

export async function POST(request: Request) {
  try {
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('resetIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }
    const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return zodFailure(parsed.error)

    const result = await resetPassword(parsed.data.token, parsed.data.newPassword)
    if (!result.ok) return apiErrorJson('linkInvalidReset', 401)

    await createSession(result.user.id)
    return NextResponse.json(ok({ role: result.user.role }))
  } catch (error) {
    console.error('[auth/reset-password]', error instanceof Error ? error.name : error)
    return apiErrorJson('internal', 500)
  }
}
