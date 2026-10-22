import { NextResponse } from 'next/server'
import { resetPassword } from '@/lib/auth/accounts'
import { createSession } from '@/lib/auth/session'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { resetPasswordSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'

export async function POST(request: Request) {
  try {
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('resetIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }
    const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })

    const result = await resetPassword(parsed.data.token, parsed.data.newPassword)
    if (!result.ok) return NextResponse.json(err('Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.'), { status: 401 })

    await createSession(result.user.id)
    return NextResponse.json(ok({ role: result.user.role }))
  } catch (error) {
    console.error('[auth/reset-password]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
