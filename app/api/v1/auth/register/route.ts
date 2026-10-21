import { NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { generateOtp, storeOtp } from '@/lib/auth/otp'
import { whatsapp } from '@/lib/whatsapp/client'
import { waTemplates } from '@/lib/notifications/templates/whatsapp'
import { normalizePhone } from '@/lib/utils/phone'
import { registerSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { resetOtpVerifyFailures } from '@/lib/auth/otpVerify'
import { PRIVACY_POLICY_VERSION } from '@/lib/constants/legal'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? 'Input tidak valid'
      return NextResponse.json(err(msg), { status: 400 })
    }

    const { fullName, email, password, phone } = parsed.data
    const normalizedPhone = normalizePhone(phone)

    // Per IP: semua pendaftaran yang lolos validasi (spam akun & WhatsApp massal).
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('otpSendIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }

    const emailTaken = await prisma.user.findUnique({ where: { email } })
    if (emailTaken) {
      return NextResponse.json(err('Email sudah terdaftar.'), { status: 409 })
    }

    const phoneTaken = await prisma.user.findUnique({ where: { phone: normalizedPhone } })
    if (phoneTaken) {
      return NextResponse.json(err('Nomor WhatsApp sudah terdaftar.'), { status: 409 })
    }

    // Per nomor: maks 3 OTP / 10 menit (CLAUDE.md). Sengaja SEBELUM user dibuat — memblokir sesudahnya akan
    // meninggalkan akun setengah jadi (email terpakai tapi tidak ada OTP).
    const perPhone = await consume(policy('otpSendPhone', normalizedPhone))
    if (!perPhone.allowed) return tooManyRequests(perPhone.retryAfterSec)

    const passwordHash = await hash(password, 12)

    await prisma.user.create({
      data: {
        email, passwordHash, fullName, phone: normalizedPhone, role: 'pilgrim', isActive: false,
        consentLogs: { create: { type: 'privacy_policy', version: PRIVACY_POLICY_VERSION } },
      },
    })

    const code = generateOtp()
    await storeOtp(normalizedPhone, code)
    await resetOtpVerifyFailures(normalizedPhone) // OTP baru: pengguna sah tidak boleh terkunci oleh kegagalan OTP lama
    await prisma.otpRequest.create({
      data: { phone: normalizedPhone, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    })

    // FAIL-CLOSED: kemudahan dev (OTP tampil di log & response, WhatsApp tidak dikirim) HANYA bila NODE_ENV persis
    // 'development'. Dulu `!== 'production'` — lingkungan mana pun yang NODE_ENV-nya salah/kosong (staging, container
    // salah konfigurasi) akan membocorkan OTP di response HTTP, yang berarti pengambilalihan akun lewat reset password.
    const isDev = process.env.NODE_ENV === 'development'
    if (isDev) {
      console.log(`\n[DEV] OTP registrasi ${normalizedPhone}: ${code}\n`)
    } else {
      await whatsapp.sendMessage({ phone: normalizedPhone, message: waTemplates.otp(code) })
    }

    return NextResponse.json(ok({ phone: normalizedPhone, devCode: isDev ? code : undefined }))
  } catch (error) {
    console.error('[auth/register]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
