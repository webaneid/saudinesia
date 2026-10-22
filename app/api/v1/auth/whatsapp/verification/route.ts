import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { requestWhatsappVerification } from '@/lib/auth/whatsappVerify'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { getPaymentConfig } from '@/lib/constants/payment'
import { ok, err } from '@/lib/validators'

// Terbitkan kode verifikasi WhatsApp: pengguna mengirim `VERIF <KODE>` dari nomornya ke nomor bisnis (ADR-0002).
export async function POST() {
  try {
    const session = await requireSession()
    const limit = await consume(policy('whatsappVerifyUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const business = getPaymentConfig().businessWa.replace(/\D/g, '')
    if (!business) return NextResponse.json(err('Nomor WhatsApp bisnis belum dikonfigurasi.'), { status: 503 })

    const r = await requestWhatsappVerification(session.userId)
    if (!r.ok) {
      const msg = r.reason === 'already_verified' ? 'Nomor WhatsApp Anda sudah terverifikasi.' : r.reason === 'no_number' ? 'Isi nomor WhatsApp terlebih dahulu.' : 'Akun tidak ditemukan.'
      return NextResponse.json(err(msg), { status: r.reason === 'not_found' ? 404 : 409 })
    }
    return NextResponse.json(ok({
      code: r.code,
      expiresAt: r.expiresAt.toISOString(),
      businessNumber: business,
      link: `https://wa.me/${business}?text=${encodeURIComponent(`VERIF ${r.code}`)}`,
    }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
    console.error('[auth/whatsapp/verification]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
