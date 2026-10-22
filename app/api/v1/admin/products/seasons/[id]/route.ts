import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager()
    const { id } = await params
    await prisma.season.delete({ where: { id } })
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Musim tidak ditemukan'), { status: 404 })
    console.error('[admin/products/seasons/[id]/DELETE]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
