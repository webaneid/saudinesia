import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { taxReportQuerySchema } from '@/lib/validators/reports'
import { requireCashView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { ReportInputError, defaultPeriod } from '@/lib/reports/profit'
import { taxInvoices, taxSummary } from '@/lib/reports/tax'
import { CSV_MAX_ROWS, csvResponse } from '@/lib/reports/csv'
import { dateInApp } from '@/lib/time'

// Ekspor CSV PPN (§10.14 Fase 12c): baris ringkasan (ditagihkan, batal/hangus, diterima) lalu satu baris per invoice terbit dalam periode (maks. CSV_MAX_ROWS).
export async function GET(req: Request) {
  try {
    await requireCashView()
    const parsed = taxReportQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const def = defaultPeriod()
    const from = parsed.data.from ?? def.from, to = parsed.data.to ?? def.to
    const [s, inv] = await Promise.all([taxSummary(from, to), taxInvoices(from, to, { page: 1, limit: CSV_MAX_ROWS, skip: 0 })])
    const rows: Array<Array<string | number | null>> = [
      ['ringkasan', 'Ditagihkan (invoice terbit, booking hidup)', null, null, null, null, s.billed.addedIdr, s.billed.includedIdr, s.billed.totalIdr, null],
      ['ringkasan', 'Invoice batal/hangus (tak dihitung)', null, null, null, null, s.billedVoid.addedIdr, s.billedVoid.includedIdr, s.billedVoid.totalIdr, null],
      ['ringkasan', 'Diterima (buku kas; termasuk = proporsional)', null, null, null, null, s.received.addedIdr, s.received.includedIdr, null, s.received.grossIdr],
      ['ringkasan', 'Bagian PPN refund dibayar (proporsional)', null, null, null, null, null, null, null, -s.received.refundIdr],
      ['ringkasan', 'Diterima bersih', null, null, null, null, null, null, null, s.received.netIdr],
      ...inv.items.map((i): Array<string | number | null> => ['invoice', i.invoiceNumber, i.bookingCode, dateInApp(i.issuedAt), i.status, i.subtotalIdr, i.addedIdr, i.includedIdr, i.addedIdr + i.includedIdr, i.receivedIdr]),
    ]
    return csvResponse(['jenis', 'nomor', 'booking', 'terbit', 'status', 'dpp_subtotal', 'ppn_ditambahkan', 'ppn_termasuk', 'ppn_ditagihkan', 'ppn_diterima_bersih'], rows, `ppn-${from}_${to}.csv`)
  } catch (e) {
    if (e instanceof ReportInputError) return NextResponse.json(err(e.message), { status: 400 })
    return authFailureResponse(e, 'admin/finance/tax/export/GET')
  }
}
