import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { paginate, parseListParams } from '@/lib/admin/pagination'

const STATUSES = ['pending', 'completed', 'rejected', 'withdrawn'] as const

export async function GET(req: Request) {
  try {
    await requireSuperAdmin()
    const params = new URL(req.url).searchParams
    const list = parseListParams(params)
    const raw = params.get('status')
    const status = (STATUSES as readonly string[]).includes(raw ?? '') ? (raw as (typeof STATUSES)[number]) : undefined // nilai asing = tanpa filter (bukan 500)
    const where = status ? { status } : {}
    const { items, meta } = await paginate(
      list,
      () => prisma.accountDeletionRequest.count({ where }),
      range => prisma.accountDeletionRequest.findMany({
        where,
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
    if (e instanceof Error && e.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
    if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/deletion-requests/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
