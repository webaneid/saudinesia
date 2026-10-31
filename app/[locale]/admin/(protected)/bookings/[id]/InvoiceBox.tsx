import { FileDown, ReceiptText } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'
import type { Bill } from '@/lib/invoice/bill'
import type { TaxLine } from '@/lib/invoice/tax'

type Props = {
  bookingId: string
  invoice: { number: string; invoiceDate: Date; dueDate: Date; revision: number; taxLines: TaxLine[] } | null
  bill: Bill
}

const pct = (n: number) => `${Number(n.toFixed(3))}%`

// Kotak Invoice di detail booking (docs/arsitektur-booking-engine-v2.md §10.4 Fase 6a): nomor, tanggal, jatuh tempo, rincian tagihan dari SATU pembaca (`billOf`).
export function InvoiceBox({ bookingId, invoice, bill }: Props) {
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex items-baseline justify-between gap-3 text-[13px] ${strong ? 'font-bold text-admin-ink' : 'text-admin-ink/80'}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  )
  return (
    <div className="admin-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="admin-section flex items-center gap-1.5"><ReceiptText className="size-3.5" /> Invoice</p>
        <a href={`/api/v1/bookings/${bookingId}/invoice`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-admin-accent-strong hover:underline">
          <FileDown className="size-3.5" /> Unduh PDF
        </a>
      </div>
      {invoice ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-admin-muted">
          <span>Nomor</span><span className="font-mono font-semibold text-admin-ink text-right">{invoice.number}</span>
          <span>Tanggal</span><span className="text-right text-admin-ink">{formatCalendarDate(invoice.invoiceDate, DATE_LONG)}</span>
          <span>Jatuh tempo</span><span className="text-right text-admin-ink">{formatCalendarDate(invoice.dueDate, DATE_LONG)}</span>
          {invoice.revision > 1 && <><span>Revisi</span><span className="text-right text-admin-ink">ke-{invoice.revision}</span></>}
        </div>
      ) : (
        <p className="text-[12px] text-admin-muted">Booking ini belum punya invoice.</p>
      )}
      <div className="space-y-1 border-t border-admin-line pt-2">
        {row('Subtotal', formatRupiah(bill.subtotal))}
        {invoice?.taxLines.map(t => row(`${t.name} ${pct(t.ratePercent)}${t.basisPercent !== 100 ? ` × ${pct(t.basisPercent)} DPP` : ''}${t.mode === 'included' ? ' (termasuk dalam harga)' : ''}`, formatRupiah(t.amountIdr)))}
        {row('Total tagihan', formatRupiah(bill.grandTotal), true)}
        {row('Terbayar', formatRupiah(bill.paid))}
        {row(bill.balance < 0 ? 'Kelebihan bayar' : 'Sisa', formatRupiah(Math.abs(bill.balance)), true)}
      </div>
    </div>
  )
}
