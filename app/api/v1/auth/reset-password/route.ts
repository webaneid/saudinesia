import { NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { createSession } from '@/lib/auth/session'
import { resetPasswordSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = resetPasswordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })
    }

    const { resetToken, newPassword } = parsed.data

    const user = await prisma.user.findUnique({
      where: { resetToken },
      select: { id: true, role: true, resetTokenExp: true },
    })

    if (!user || !user.resetTokenExp || user.resetTokenExp < new Date()) {
      return NextResponse.json(err('Token tidak valid atau sudah kadaluarsa.'), { status: 401 })
    }

    const passwordHash = await hash(newPassword, 12)
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExp: null },
    })

    await createSession({ userId: user.id, role: user.role })
    return NextResponse.json(ok({ role: user.role }))
  } catch (error) {
    console.error('[auth/reset-password]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
