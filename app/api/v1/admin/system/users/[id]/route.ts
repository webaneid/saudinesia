import { NextResponse } from 'next/server'
import { updateUserByAdmin } from '@/lib/auth/adminUsers'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { userAdminUpdateSchema } from '@/lib/validators/adminUpdates'
import { prisma } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, fullName: true, email: true, role: true, isActive: true, createdAt: true } })
    if (!user) return NextResponse.json(err('Pengguna tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(user))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/system/users/[id]/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSuperAdmin()
    const { id } = await params
    const parsed = userAdminUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const result = await updateUserByAdmin(id, parsed.data, session.userId)
    if (!result.ok) {
      if (result.reason === 'not_found') return NextResponse.json(err('Pengguna tidak ditemukan'), { status: 404 })
      const message = result.reason === 'self'
        ? 'Anda tidak dapat mengubah peran atau menonaktifkan akun Anda sendiri.'
        : 'Perubahan ini akan menyisakan sistem tanpa superadmin aktif.'
      return NextResponse.json(err(message), { status: 422 })
    }
    return NextResponse.json(ok(result.user))
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
