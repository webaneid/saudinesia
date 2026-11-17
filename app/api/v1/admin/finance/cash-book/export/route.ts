import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { cashBookQuerySchema } from '@/lib/validators/reports'
import { requireCashView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { ReportInputError, defaultPeriod } from '@/lib/reports/profit'
import { cashBookEntries } from '@/lib/cash/query'
import { CASH_COMPONENT_LABEL, CASH_DIRECTION_LABEL } from '@/lib/cash/labels'
import { CSV_MAX_ROWS, csvResponse } from '@/lib/reports/csv'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'

// Ekspor CSV Buku Kas (§10.14 Fase 12a): filter yang sama dengan halaman, maks 10.000 entri terbaru. Entri tak memuat teks bebas/PII (hanya akun, komponen, kode booking).
export async function GET(req: Request) {
  try {
    await requireCashView()
    const parsed = cashBookQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const q = parsed.data
    const def = defaultPeriod()
    const f = { from: q.from ?? def.from, to: q.to ?? def.to, account: q.account, direction: q.direction, component: q.component }
    const { rows } = await cashBookEntries(f, 1, CSV_MAX_ROWS)
    return csvResponse(
      ['waktu', 'arah', 'komponen', 'akun', 'kode_booking', 'jumlah'],
      rows.map(r => [formatInstant(r.entryDate, DATETIME_MEDIUM), CASH_DIRECTION_LABEL[r.direction], CASH_COMPONENT_LABEL[r.component], r.account, r.bookingCode, r.direction === 'in' ? r.amountIdr : -r.amountIdr]),
      `buku-kas-${f.from}_${f.to}.csv`,
    )
  } catch (e) {
    if (e instanceof ReportInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, 'admin/finance/cash-book/export/GET')
  }
}
