import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { marginHealthQuerySchema } from '@/lib/validators/pricing'
import { requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { marginHealth } from '@/lib/pricing/engine'

// Kesehatan Margin (docs/arsitektur-harga-terpadu.md §16): titik harga yang rugi / margin tipis / modal belum lengkap / belum berharga. Berhalaman (batas 100).
export async function GET(req: Request) {
  try {
    await requirePricingView()
    const q = marginHealthQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const result = await marginHealth({ filter: q.filter, ownerType: q.ownerType, page: q.page, pageSize: q.limit })
    return NextResponse.json(ok(result.rows, {
      total: result.total, page: result.page, limit: result.pageSize, totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      counts: result.counts, warnBelowPercent: result.warnBelowPercent,
    }))
  } catch (e) {
    return authFailureResponse(e, 'admin/pricing/health/GET')
  }
}
