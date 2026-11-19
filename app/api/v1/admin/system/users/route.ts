import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { hash } from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { staffCreateSchema } from '@/lib/validators/adminUpdates'
import { paginate, parseListParams } from '@/lib/admin/pagination'
import { visibleStaffWhere } from '@/lib/auth/adminUsers'
import { logError } from '@/lib/log'
import { auditIp, recordStaffEvent } from '@/lib/audit/staff'

export async function GET(req: Request) {
  try {
    const session = await requireSuperAdmin()
    const where = visibleStaffWhere(session) // akun bayangan Platform Provider tak terlihat oleh superadmin klien
    const list = parseListParams(new URL(req.url).searchParams)
    const { items, meta } = await paginate(
      list,
      () => prisma.user.count({ where }),
      range => prisma.user.findMany({
        where,
        // id sebagai tie-breaker: createdAt bisa kembar, dan halaman harus stabil antar request
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...range,
        select: { id: true, fullName: true, email: true, phone: true, role: true, isActive: true, createdAt: true, whatsappVerifiedAt: true },
      }),
    )
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) return NextResponse.json(err('Forbidden'), { status: 403 })
    logError('admin/system/users/GET', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSuperAdmin()
    const parsed = staffCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { fullName, email, password, role } = parsed.data

    const passwordHash = await hash(password, 12)
    // Staf dibuat superadmin (bukan pendaftaran mandiri) — emailnya dianggap terverifikasi.
    // Akun + jejak staf (SEC-304) dalam satu transaksi: tanpa jejak, akun tak dibuat.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { fullName, email, passwordHash, role, isActive: true, emailVerifiedAt: new Date() }, select: { id: true, email: true } })
      await recordStaffEvent(tx, { action: 'staff_create', actorId: session.userId, targetUserId: created.id, ip: auditIp(req), summary: { role } })
      return created
    })
    return NextResponse.json(ok({ id: user.id, email: user.email }), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) return NextResponse.json(err('Forbidden'), { status: 403 })
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return NextResponse.json(err('Email sudah digunakan'), { status: 409 })
    logError('admin/system/users/POST', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
