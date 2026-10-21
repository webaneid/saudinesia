import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { userAdminUpdateSchema } from '@/lib/validators/adminUpdates'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const parsed = userAdminUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const user = await prisma.user.update({ where: { id }, data: parsed.data, select: { id: true, role: true, isActive: true } })
    return NextResponse.json(ok(user))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2025') {
      return NextResponse.json(err('Pengguna tidak ditemukan'), { status: 404 })
    }
    console.error('[admin/system/users/[id]/PUT]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
