import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { varianceQuerySchema } from '@/lib/validators/reports'
import { requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { ReportInputError, defaultPeriod } from '@/lib/reports/profit'
import { getVarianceLines, getVarianceReport } from '@/lib/reports/variance'

// Selisih HPP vs aktual (docs/arsitektur-harga-terpadu.md §20): ringkasan + irisan produk/bulan + belanja per vendor/komponen + baris rencana berhalaman. Peran: policy harga.
export async function GET(req: Request) {
  try {
    await requirePricingView()
    const parsed = varianceQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const q = parsed.data
    const def = defaultPeriod()
    const params = { from: q.from ?? def.from, to: q.to ?? def.to }
    const [report, lines] = await Promise.all([getVarianceReport(params), getVarianceLines(params, q.page, q.limit, q.only === 'variance')])
    return NextResponse.json(ok({ ...report, lines: lines.rows }, { total: lines.total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(lines.total / q.limit)) }))
  } catch (e) {
    if (e instanceof ReportInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, 'admin/reports/cost-variance/GET')
  }
}
