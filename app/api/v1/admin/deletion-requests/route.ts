import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { paginate, parseListParams } from '@/lib/admin/pagination'

export async function GET(req: Request) {
  try {
    await requireSuperAdmin()
    const list = parseListParams(new URL(req.url).searchParams)
    const { items, meta } = await paginate(
      list,
      () => prisma.accountDeletionRequest.count(),
      range => prisma.accountDeletionRequest.findMany({
        include: {
          user: { select: { fullName: true, email: true } },
          processedBy: { select: { fullName: true } },
        },
        // id sebagai tie-breaker: requestedAt bisa kembar, dan halaman harus stabil antar request
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        ...range,
      }),
    )
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/deletion-requests/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
