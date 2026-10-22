import { NextResponse } from 'next/server'
import { completeRegistration } from '@/lib/auth/accounts'
import { createSession } from '@/lib/auth/session'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { completeRegistrationSchema } from '@/lib/validators/auth'
import { notify } from '@/lib/notifications/notify'
import { ok, err } from '@/lib/validators'

// Pemilik email memilih password → akun dibuat (email terverifikasi) → langsung masuk.
export async function POST(request: Request) {
  try {
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('authTokenIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }
    const parsed = completeRegistrationSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })

    const result = await completeRegistration(parsed.data.token, parsed.data.password)
    if (!result.ok) {
      return result.reason === 'exists'
        ? NextResponse.json(err('Akun dengan email ini sudah ada. Silakan masuk.'), { status: 409 })
        : NextResponse.json(err('Tautan tidak valid atau sudah kedaluwarsa. Daftar ulang untuk mendapat tautan baru.'), { status: 401 })
    }

    await createSession(result.user.id)
    void notify({ userId: result.user.id, event: { type: 'welcome', name: result.user.fullName }, dedupe: true })
    return NextResponse.json(ok({ role: result.user.role }))
  } catch (error) {
    console.error('[auth/registration/complete]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
