import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { requestWhatsappVerification } from '@/lib/auth/whatsappVerify'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { linkedWhatsappNumber } from '@/lib/whatsapp/number'
import { ok } from '@/lib/validators'
import { apiErrorJson } from '@/lib/errors/api'
import { logError } from '@/lib/log'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Nomor WhatsApp Saudinesia yang tertaut (hasil scan) — tampil di kartu verifikasi sebelum tombol ditekan; null = sedang tidak tersedia.
export async function GET() {
  try {
    await requireSession()
    return NextResponse.json(ok({ businessNumber: await linkedWhatsappNumber() }), { headers: NO_STORE })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    logError('auth/whatsapp/verification', error)
    return apiErrorJson('internal', 500)
  }
}

// Terbitkan kode verifikasi WhatsApp: pengguna mengirim `VERIF <KODE>` dari nomornya ke nomor bisnis (ADR-0002).
export async function POST() {
  try {
    const session = await requireSession()
    const business = await linkedWhatsappNumber()
    if (!business) return apiErrorJson('whatsappUnavailable', 503)
    const limit = await consume(policy('whatsappVerifyUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

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
    logError('auth/whatsapp/verification', error)
    return apiErrorJson('internal', 500)
  }
}
