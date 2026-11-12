import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { requestWhatsappVerification } from '@/lib/auth/whatsappVerify'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { businessWaDigits } from '@/lib/constants/payment'
import { ok } from '@/lib/validators'
import { apiErrorJson } from '@/lib/errors/api'

// Terbitkan kode verifikasi WhatsApp: pengguna mengirim `VERIF <KODE>` dari nomornya ke nomor bisnis (ADR-0002).
export async function POST() {
  try {
    const session = await requireSession()
    const limit = await consume(policy('whatsappVerifyUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const business = businessWaDigits()
    if (!business) return apiErrorJson('whatsappBusinessMissing', 503)

    const r = await requestWhatsappVerification(session.userId)
    if (!r.ok) {
      const code = r.reason === 'already_verified' ? 'whatsappAlreadyVerified' : r.reason === 'no_number' ? 'whatsappNumberMissing' : 'accountNotFound'
      return apiErrorJson(code, r.reason === 'not_found' ? 404 : 409)
    }
    return NextResponse.json(ok({
      code: r.code,
      expiresAt: r.expiresAt.toISOString(),
      businessNumber: business,
      link: `https://wa.me/${business}?text=${encodeURIComponent(`VERIF ${r.code}`)}`,
    }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    console.error('[auth/whatsapp/verification]', error instanceof Error ? error.name : error)
    return apiErrorJson('internal', 500)
  }
}
