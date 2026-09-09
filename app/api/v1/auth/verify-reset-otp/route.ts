import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAndConsumeOtp } from '@/lib/auth/otp'
import { verifyResetOtpSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'
import { randomUUID } from 'crypto'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = verifyResetOtpSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })
    }

    const { phone, code } = parsed.data
    const valid = await verifyAndConsumeOtp(phone, code)
    if (!valid) {
      return NextResponse.json(err('Kode OTP salah atau sudah kadaluarsa.'), { status: 401 })
    }

    const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } })
    if (!user) {
      return NextResponse.json(err('Akun tidak ditemukan.'), { status: 404 })
    }

    const resetToken = randomUUID()
    const resetTokenExp = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExp },
    })

    return NextResponse.json(ok({ resetToken }))
  } catch (error) {
    console.error('[auth/verify-reset-otp]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
