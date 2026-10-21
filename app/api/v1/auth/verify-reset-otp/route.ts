import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyOtpGuarded } from '@/lib/auth/otpVerify'
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
    // Batas percobaan salah per nomor & per IP (SEC-04) — kode 6 digit tidak boleh bisa ditebak tanpa batas.
    const verified = await verifyOtpGuarded(request, phone, code)
    if (!verified.ok) return verified.response

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
