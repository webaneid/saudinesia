import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { revenueShareIncomeExportSchema } from '@/lib/validators/revenueShare'
import { requireSuperAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { dateInApp, yearInApp } from '@/lib/time'
import { CSV_MAX_ROWS, csvResponse } from '@/lib/reports/csv'
import { bookingIncome, monthlyIncome } from '@/lib/revenue-share/income'
import { REVENUE_SHARE_BASIS_LABEL } from '@/lib/revenue-share/example'

// Ekspor CSV Pendapatan Platform Provider (Fase 13e-2): ringkasan bulanan satu tahun, atau potensi vs hak per booking (maks 10.000 baris). Superadmin
// (termasuk akun Platform Provider) — rincian bagi hasil internal. Tanpa data pribadi.
export async function GET(req: Request) {
  try {
    await requireSuperAdmin()
    const parsed = revenueShareIncomeExportSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const q = parsed.data
    if (q.kind === 'monthly') {
      const year = q.year ?? yearInApp()
      const y = await monthlyIncome(year)
      const rows: Array<Array<string | number | null>> = [[`${year}-saldo-awal`, null, null, y.openingIdr], ...y.months.map(m => [m.month, m.entitledIdr, m.paidOutIdr, m.balanceEndIdr])]
      return csvResponse(['bulan', 'hak_masuk', 'dicairkan', 'saldo_akhir'], rows, `bagi-hasil-bulanan-${year}.csv`)
    }
    const { items } = await bookingIncome({ status: q.status, q: q.q || undefined }, { page: 1, limit: CSV_MAX_ROWS, skip: 0 })
    return csvResponse(
      ['kode_booking', 'nomor_invoice', 'terbit', 'status', 'persen', 'dasar', 'potensi', 'hak', 'hak_pct', 'potensi_akhir'],
      items.map(r => [r.bookingCode, r.invoiceNumber, r.issuedAt ? dateInApp(new Date(r.issuedAt)) : null, r.status, r.rule?.percent ?? null, r.rule ? REVENUE_SHARE_BASIS_LABEL[r.rule.basis] : null, r.potentialIdr, r.entitledIdr, r.entitledPct, r.final ? 'ya' : 'tidak']),
      `bagi-hasil-per-booking${q.status ? `-${q.status}` : ''}.csv`,
    )
  } catch (e) {
    return authFailureResponse(e, 'admin/system/platform-provider/income/export/GET')
  }
}
