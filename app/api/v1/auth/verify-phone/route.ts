import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAndConsumeOtp } from '@/lib/auth/otp'
import { createSession } from '@/lib/auth/session'
import { verifyPhoneSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = verifyPhoneSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })
    }

    const { phone, code } = parsed.data
    const valid = await verifyAndConsumeOtp(phone, code)
    if (!valid) {
      return NextResponse.json(err('Kode OTP salah atau sudah kadaluarsa.'), { status: 401 })
    }

    const user = await prisma.user.update({
      where: { phone },
      data: { isActive: true, phoneVerifiedAt: new Date() },
      select: { id: true, role: true, fullName: true },
    })

    await createSession({ userId: user.id, role: user.role })
    return NextResponse.json(ok({ role: user.role }))
  } catch (error) {
    console.error('[auth/verify-phone]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
