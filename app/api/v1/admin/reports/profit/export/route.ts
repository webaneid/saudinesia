import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { profitQuerySchema } from '@/lib/validators/reports'
import { requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { defaultPeriod, getBookingProfitRows, ReportInputError } from '@/lib/reports/profit'
import { CSV_MAX_ROWS, csvResponse } from '@/lib/reports/csv'

// Ekspor CSV daftar booking laporan untung (maks 10.000 baris; urut terbaru dulu). Peran: policy harga.
export async function GET(req: Request) {
  try {
    await requirePricingView()
    const parsed = profitQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const def = defaultPeriod()
    const params = { from: parsed.data.from ?? def.from, to: parsed.data.to ?? def.to, scope: parsed.data.scope }
    const { rows } = await getBookingProfitRows(params, 1, CSV_MAX_ROWS, parsed.data.onlyLoss === '1')
    const head = ['kode_booking', 'tanggal_pesan', 'status', 'total', 'dibayar', 'refund', 'penjualan', 'modal_diketahui', 'jual_tanpa_modal', 'untung', 'margin_pct', 'cakupan_modal_pct', 'terealisasi_jual', 'terealisasi_untung']
    return csvResponse(head, rows.map(r => [r.bookingCode, r.createdAt.slice(0, 10), r.status, r.totalIdr, r.paidIdr, r.refundedIdr, r.sellIdr, r.costKnownIdr, r.sellUnknownCostIdr, r.profitIdr, r.marginPct, r.costCoveragePct, r.realizedSellIdr, r.realizedProfitIdr]), `laporan-untung-${params.from}_${params.to}.csv`)
  } catch (e) {
    if (e instanceof ReportInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, 'admin/reports/profit/export/GET')
  }
}
