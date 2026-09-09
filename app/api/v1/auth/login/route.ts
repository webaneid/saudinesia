import { NextResponse } from 'next/server'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { createSession } from '@/lib/auth/session'
import { loginSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })
    }

    const { email, password } = parsed.data

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, role: true, isActive: true, fullName: true },
    })

    // Same error for "not found" and "wrong password" — prevent email enumeration
    const invalid = () => NextResponse.json(err('Email atau password salah.'), { status: 401 })

    if (!user) return invalid()
    if (!user.isActive) {
      return NextResponse.json(err('Akun belum diverifikasi. Cek WhatsApp untuk kode OTP.'), { status: 403 })
    }

    const match = await compare(password, user.passwordHash)
    if (!match) return invalid()

    await createSession({ userId: user.id, role: user.role })
    return NextResponse.json(ok({ role: user.role }))
  } catch (error) {
    console.error('[auth/login]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
