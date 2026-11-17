import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { taxReportQuerySchema } from '@/lib/validators/reports'
import { requireCashView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { ReportInputError, defaultPeriod } from '@/lib/reports/profit'
import { taxInvoices, taxSummary } from '@/lib/reports/tax'

// Laporan PPN (§10.14 Fase 12c, K12-3): ditagihkan (invoice terbit) vs diterima (buku kas) per periode + daftar invoice. Baca saja; peran lewat lib/pricing/policy.ts.
export async function GET(req: Request) {
  try {
    await requireCashView()
    const parsed = taxReportQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const def = defaultPeriod()
    const from = parsed.data.from ?? def.from, to = parsed.data.to ?? def.to
    const { page, limit } = parsed.data
    const [summary, invoices] = await Promise.all([taxSummary(from, to), taxInvoices(from, to, { page, limit, skip: (page - 1) * limit })])
    return NextResponse.json(ok({ summary, invoices: invoices.items }, invoices.meta))
  } catch (e) {
    if (e instanceof ReportInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, 'admin/finance/tax/GET')
  }
}
