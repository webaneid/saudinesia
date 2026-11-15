import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { cashBookQuerySchema } from '@/lib/validators/reports'
import { requireCashView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { ReportInputError, defaultPeriod } from '@/lib/reports/profit'
import { cashAccountsList, cashBookEntries, cashBookSummary } from '@/lib/cash/query'

// Buku kas (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-1): ringkasan per akun + entri berhalaman. Baca saja; peran lewat lib/pricing/policy.ts.
export async function GET(req: Request) {
  try {
    await requireCashView()
    const parsed = cashBookQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const q = parsed.data
    const def = defaultPeriod()
    const f = { from: q.from ?? def.from, to: q.to ?? def.to, account: q.account, direction: q.direction, component: q.component }
    const [summary, entries, accounts] = await Promise.all([cashBookSummary(f), cashBookEntries(f, q.page, q.limit), cashAccountsList()])
    return NextResponse.json(ok({ params: { from: f.from, to: f.to }, summary, accounts, rows: entries.rows }, { total: entries.total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(entries.total / q.limit)) }))
  } catch (e) {
    if (e instanceof ReportInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, 'admin/finance/cash-book/GET')
  }
}
