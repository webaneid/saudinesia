import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { hash } from 'bcryptjs'
import { passwordSchema } from '@/lib/validators/auth'

export async function GET() {
  try {
    await requireSuperAdmin()
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, fullName: true, email: true, phone: true, role: true, isActive: true, createdAt: true } })
    return NextResponse.json(ok(users))
  } catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdmin()
    const b = await req.json()
    const pwCheck = passwordSchema.safeParse(b.password)
    if (!pwCheck.success) return NextResponse.json(err(pwCheck.error.errors[0]?.message ?? 'Password tidak valid'), { status: 400 })
    const passwordHash = await hash(b.password, 12)
    const user = await prisma.user.create({ data: { fullName: b.fullName, email: b.email, passwordHash, role: b.role ?? 'admin', isActive: true } })
    return NextResponse.json(ok({ id: user.id, email: user.email }), { status: 201 })
  } catch (e) {
    if (e instanceof Error && e.message.includes('Unique')) return NextResponse.json(err('Email sudah digunakan'), { status: 409 })
    return NextResponse.json(err('Forbidden'), { status: 403 })
  }
}
