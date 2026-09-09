import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireManager(); const { id } = await params; await prisma.season.delete({ where: { id } }); return NextResponse.json(ok(null)) }
  catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}
