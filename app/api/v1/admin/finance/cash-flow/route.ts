import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { cashFlowQuerySchema } from '@/lib/validators/reports'
import { requireCashView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { ReportInputError, defaultPeriod } from '@/lib/reports/profit'
import { cashFlow } from '@/lib/cash/flow'
import { cashAccountsList } from '@/lib/cash/query'

// Arus kas (§10.14 Fase 12a): saldo awal → masuk/keluar per komponen → saldo akhir, per akun. Baca saja; peran lewat lib/pricing/policy.ts.
export async function GET(req: Request) {
  try {
    await requireCashView()
    const parsed = cashFlowQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const def = defaultPeriod()
    const f = { from: parsed.data.from ?? def.from, to: parsed.data.to ?? def.to, account: parsed.data.account }
    const [flow, accounts] = await Promise.all([cashFlow(f), cashAccountsList()])
    return NextResponse.json(ok({ flow, accounts }))
  } catch (e) {
    if (e instanceof ReportInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, 'admin/finance/cash-flow/GET')
  }
}
