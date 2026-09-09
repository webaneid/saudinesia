import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager()
    const { id } = await params
    const body = await req.json()
    return NextResponse.json(ok(await prisma.hajiProduct.update({ where: { id }, data: body })))
  } catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager()
    const { id } = await params
    await prisma.hajiProduct.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json(ok(null))
  } catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}
