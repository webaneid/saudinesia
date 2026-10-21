import { NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { generateOtp, storeOtp } from '@/lib/auth/otp'
import { whatsapp } from '@/lib/whatsapp/client'
import { waTemplates } from '@/lib/notifications/templates/whatsapp'
import { normalizePhone } from '@/lib/utils/phone'
import { registerSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'
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

    const emailTaken = await prisma.user.findUnique({ where: { email } })
    if (emailTaken) {
      return NextResponse.json(err('Email sudah terdaftar.'), { status: 409 })
    }

    const phoneTaken = await prisma.user.findUnique({ where: { phone: normalizedPhone } })
    if (phoneTaken) {
      return NextResponse.json(err('Nomor WhatsApp sudah terdaftar.'), { status: 409 })
    }

    const passwordHash = await hash(password, 12)

    await prisma.user.create({
      data: {
        email, passwordHash, fullName, phone: normalizedPhone, role: 'pilgrim', isActive: false,
        consentLogs: { create: { type: 'privacy_policy', version: PRIVACY_POLICY_VERSION } },
      },
    })

    const code = generateOtp()
    await storeOtp(normalizedPhone, code)
    await prisma.otpRequest.create({
      data: { phone: normalizedPhone, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    })

    const isDev = process.env.NODE_ENV !== 'production'
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
