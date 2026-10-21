import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateOtp, storeOtp } from '@/lib/auth/otp'
import { whatsapp } from '@/lib/whatsapp/client'
import { waTemplates } from '@/lib/notifications/templates/whatsapp'
import { forgotPasswordSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'

function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***'
  return phone.slice(0, 4) + '***' + phone.slice(-3)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = forgotPasswordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })
    }

    const { email } = parsed.data
    const user = await prisma.user.findUnique({
      where: { email },
      select: { phone: true, phoneVerifiedAt: true, isActive: true },
    })

    // Always return ok — don't reveal whether email exists
    if (!user?.phone || !user.phoneVerifiedAt) {
      return NextResponse.json(ok({ masked: null, hint: 'Jika email terdaftar dan WA sudah diverifikasi, OTP akan dikirim.' }))
    }

    const code = generateOtp()
    await storeOtp(user.phone, code)
    await prisma.otpRequest.create({
      data: { phone: user.phone, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    })

    // FAIL-CLOSED: kemudahan dev (OTP tampil di log & response, WhatsApp tidak dikirim) HANYA bila NODE_ENV persis
    // 'development'. Dulu `!== 'production'` — lingkungan mana pun yang NODE_ENV-nya salah/kosong (staging, container
    // salah konfigurasi) akan membocorkan OTP di response HTTP, yang berarti pengambilalihan akun lewat reset password.
    const isDev = process.env.NODE_ENV === 'development'
    if (isDev) {
      console.log(`\n[DEV] OTP reset password ${user.phone}: ${code}\n`)
    } else {
      await whatsapp.sendMessage({ phone: user.phone, message: waTemplates.otp(code) })
    }

    return NextResponse.json(ok({
      masked: maskPhone(user.phone),
      phone: user.phone,
      devCode: isDev ? code : undefined,
    }))
  } catch (error) {
    console.error('[auth/forgot-password]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
