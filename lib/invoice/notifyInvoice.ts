import { prisma } from '@/lib/db'
import { notify } from '@/lib/notifications/notify'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { billOf } from './bill'
import { invoiceLinkToken } from './link'

// Notifikasi "invoice terbit" berisi tautan invoice publik (docs/arsitektur-booking-engine-v2.md §10.4 6c, P2) — SATU pemanggil `notify` untuk kejadian ini:
// terbit draf admin, checkout jamaah, dan "Kirim ulang invoice". Dipanggil SETELAH transaksi commit; `notify` tak pernah melempar (WhatsApp/email best-effort).
export async function sendInvoiceNotification(bookingId: string, opts: { dedupe: boolean; locale?: string }): Promise<boolean> {
  try {
    return await send(bookingId, opts)
  } catch (e) {
    console.error('[invoice-notify] gagal menyiapkan notifikasi:', e instanceof Error ? e.name : 'unknown') // tak pernah melempar: dipanggil `void` setelah commit
    return false
  }
}

async function send(bookingId: string, opts: { dedupe: boolean; locale?: string }): Promise<boolean> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true, bookingCode: true, status: true, totalAmount: true, invoice: { select: { id: true, number: true, linkVersion: true, dueDate: true, taxAddedIdr: true, taxIncludedIdr: true } } },
  })
  if (!b?.invoice || b.status === 'draft') return false
  const path = `/${opts.locale ?? 'id'}/invoice/${invoiceLinkToken(b.invoice)}`
  await notify({
    userId: b.userId, bookingId, dedupe: opts.dedupe,
    event: { type: 'invoice_issued', code: b.bookingCode, number: b.invoice.number, total: formatRupiah(billOf({ totalAmount: b.totalAmount, invoice: b.invoice }).grandTotal), dueDate: formatCalendarDate(b.invoice.dueDate, DATE_LONG), path },
  })
  return true
}
