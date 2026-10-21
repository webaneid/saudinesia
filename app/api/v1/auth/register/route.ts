import { NextResponse } from 'next/server'
import { requestRegistration } from '@/lib/auth/accounts'
import { sendAuthEmail } from '@/lib/auth/authEmail'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { maskE164 } from '@/lib/utils/phone'
import { registerSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'

// Pendaftaran manual (docs/arsitektur-auth.md §3.2): TIDAK membuat akun — mengirim tautan ke email. Respons SERAGAM untuk
// email baru maupun yang sudah terdaftar (tidak membocorkan keberadaan akun).
export async function POST(request: Request) {
  try {
    const parsed = registerSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })
    }
    const input = parsed.data

    // Batas dihitung SEBELUM mencari akun dan sama untuk email baru/lama — 429 tidak boleh membocorkan apa pun.
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('authEmailSendIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }
    const perEmail = await consume(policy('authEmailSendEmail', input.email))
    if (!perEmail.allowed) return tooManyRequests(perEmail.retryAfterSec)

    const outcome = await requestRegistration(input)
    // Dikirim TANPA ditunggu: lama balasan sama untuk email baru/lama (kirim email ke Resend memakan waktu — kalau hanya salah satu
    // cabang yang menunggu, selisih waktu membocorkan keberadaan akun). sendAuthEmail tidak pernah melempar dan mencatat kegagalan sendiri.
    if (outcome.kind === 'pending') {
      void sendAuthEmail('registration', input.email, { name: input.fullName, locale: input.locale, token: outcome.token, whatsappMasked: maskE164(input.whatsapp) })
    } else {
      void sendAuthEmail('already_registered', input.email, { name: outcome.fullName, locale: input.locale })
    }

    return NextResponse.json(ok({ sent: true }))
  } catch (error) {
    console.error('[auth/register]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
