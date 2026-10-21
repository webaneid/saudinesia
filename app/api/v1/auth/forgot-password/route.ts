import { NextResponse } from 'next/server'
import { requestPasswordReset } from '@/lib/auth/accounts'
import { sendAuthEmail } from '@/lib/auth/authEmail'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { forgotPasswordSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'

// Reset password lewat tautan email (docs/arsitektur-auth.md §3.2). Respons SERAGAM untuk email terdaftar maupun tidak.
export async function POST(request: Request) {
  try {
    const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })
    const { email, locale } = parsed.data

    // Batas dihitung SEBELUM mencari akun dan sama untuk email yang ada maupun tidak — 429 tidak boleh membocorkan apakah email terdaftar.
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('authEmailSendIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }
    const perEmail = await consume(policy('authEmailSendEmail', email))
    if (!perEmail.allowed) return tooManyRequests(perEmail.retryAfterSec)

    const outcome = await requestPasswordReset(email)
    if (outcome.kind === 'send') {
      // Tanpa ditunggu — email tidak terdaftar membalas segera, jadi email terdaftar pun harus segera (anti-enumerasi lewat waktu).
      void sendAuthEmail('password_reset', email, { name: outcome.fullName, locale, token: outcome.token })
    }
    return NextResponse.json(ok({ sent: true }))
  } catch (error) {
    console.error('[auth/forgot-password]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
