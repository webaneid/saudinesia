import { NextResponse } from 'next/server'
import { requireManager } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { parseListParams } from '@/lib/table/pagination'
import { listQuotas, openQuotas, TransportQuotaError } from '@/lib/transport/quotas'
import { ok, err } from '@/lib/validators'
import { openQuotasSchema, quotaListQuerySchema } from '@/lib/validators/transportQuota'

export async function GET(req: Request) {
  try {
    await requireManager()
    const sp = new URL(req.url).searchParams
    const q = quotaListQuerySchema.safeParse({ tripId: sp.get('tripId'), pricingId: sp.get('pricingId') || undefined })
    if (!q.success) return NextResponse.json(err('Parameter tidak valid'), { status: 400 })
    const { items, meta } = await listQuotas(q.data.tripId, q.data.pricingId, parseListParams(sp))
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    return authFailureResponse(e, 'admin/products/transport/quotas/GET')
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = openQuotasSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    return NextResponse.json(ok(await openQuotas(parsed.data)), { status: 201 })
  } catch (e) {
    if (e instanceof TransportQuotaError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/products/transport/quotas/POST')
  }
}
