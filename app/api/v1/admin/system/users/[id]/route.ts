import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const body = await req.json()
    const user = await prisma.user.update({ where: { id }, data: body, select: { id: true, role: true, isActive: true } })
    return NextResponse.json(ok(user))
  } catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}
