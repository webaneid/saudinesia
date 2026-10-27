import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { profitQuerySchema } from '@/lib/validators/reports'
import { requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { defaultPeriod, getBookingProfitRows, getProfitReport, ReportInputError } from '@/lib/reports/profit'

// Laporan untung dari snapshot (docs/arsitektur-harga-terpadu.md §19): ringkasan + irisan produk/vendor/bulan + daftar booking berhalaman. Peran lewat policy harga
// (modal/untung = hanya admin; jamaah dan publik tidak pernah).
export async function GET(req: Request) {
  try {
    await requirePricingView()
    const parsed = profitQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const q = parsed.data
    const def = defaultPeriod()
    const params = { from: q.from ?? def.from, to: q.to ?? def.to, scope: q.scope }
    const [report, list] = await Promise.all([getProfitReport(params), getBookingProfitRows(params, q.page, q.limit)])
    return NextResponse.json(ok({ ...report, bookings: list.rows }, { total: list.total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(list.total / q.limit)) }))
  } catch (e) {
    if (e instanceof ReportInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, 'admin/reports/profit/GET')
  }
}
