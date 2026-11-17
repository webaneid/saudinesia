import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { cashFlowQuerySchema } from '@/lib/validators/reports'
import { requireCashView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { ReportInputError, defaultPeriod } from '@/lib/reports/profit'
import { cashFlow } from '@/lib/cash/flow'
import { CASH_COMPONENT_LABEL, CASH_DIRECTION_LABEL } from '@/lib/cash/labels'
import { csvResponse } from '@/lib/reports/csv'

// Ekspor CSV Arus Kas (§10.14 Fase 12a): baris per akun (saldo awal, masuk, keluar, saldo akhir), baris total, lalu rincian per komponen.
export async function GET(req: Request) {
  try {
    await requireCashView()
    const parsed = cashFlowQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const def = defaultPeriod()
    const f = { from: parsed.data.from ?? def.from, to: parsed.data.to ?? def.to, account: parsed.data.account }
    const flow = await cashFlow(f)
    const rows: Array<Array<string | number | null>> = [
      ...flow.accounts.map(a => ['akun', a.name, a.openingIdr, a.inIdr, a.outIdr, a.closingIdr]),
      ['total', 'Semua akun', flow.openingIdr, flow.inIdr, flow.outIdr, flow.closingIdr],
      ...flow.components.map(c => ['komponen', `${CASH_DIRECTION_LABEL[c.direction]} · ${CASH_COMPONENT_LABEL[c.component]}`, null, c.direction === 'in' ? c.amountIdr : null, c.direction === 'out' ? c.amountIdr : null, null]),
    ]
    return csvResponse(['jenis', 'nama', 'saldo_awal', 'masuk', 'keluar', 'saldo_akhir'], rows, `arus-kas-${f.from}_${f.to}.csv`)
  } catch (e) {
    if (e instanceof ReportInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, 'admin/finance/cash-flow/export/GET')
  }
}
