import { prisma } from '@/lib/db'
import { notify, type ChannelOutcome } from '@/lib/notifications/notify'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { billOf } from './bill'
import { invoiceLinkToken } from './link'
import { appUrl } from '@/lib/email/templates'

// Notifikasi "invoice terbit" berisi tautan invoice publik (docs/arsitektur-booking-engine-v2.md §10.4 6c, P2) — SATU pemanggil `notify` untuk kejadian ini:
// terbit draf admin, checkout jamaah, dan "Kirim ulang invoice". Dipanggil SETELAH transaksi commit; `notify` tak pernah melempar (WhatsApp/email best-effort).
export async function sendInvoiceNotification(bookingId: string, opts: { dedupe: boolean; locale?: string }): Promise<ChannelOutcome[] | null> {
  try {
    return await send(bookingId, opts)
  } catch (e) {
    console.error('[invoice-notify] gagal menyiapkan notifikasi:', e instanceof Error ? e.name : 'unknown') // tak pernah melempar: dipanggil `void` setelah commit
    return null
  }
}

/** `null` = tak ada invoice yang boleh dikirim (draf/tak ada); selain itu hasil per kanal (terkirim/dilewati — mis. alamat/nomor belum terverifikasi). */
async function send(bookingId: string, opts: { dedupe: boolean; locale?: string }): Promise<ChannelOutcome[] | null> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true, bookingCode: true, status: true, totalAmount: true, invoice: { select: { id: true, number: true, linkVersion: true, dueDate: true, taxAddedIdr: true, taxIncludedIdr: true } } },
  })
  if (!b?.invoice || b.status === 'draft') return null
  // Tautan = kredensial pembaca: hanya dikirim bila origin publik HTTPS (development: http lokal diizinkan). APP_URL salah isi → notifikasi tanpa tautan.
  const base = appUrl()
  const linkOk = base.startsWith('https://') || (process.env.NODE_ENV === 'development' && base.startsWith('http://'))
  const path = linkOk ? `/${opts.locale ?? 'id'}/invoice/${invoiceLinkToken(b.invoice)}` : null
  return notify({
    userId: b.userId, bookingId, dedupe: opts.dedupe,
    event: { type: 'invoice_issued', code: b.bookingCode, number: b.invoice.number, total: formatRupiah(billOf({ totalAmount: b.totalAmount, invoice: b.invoice }).grandTotal), dueDate: formatCalendarDate(b.invoice.dueDate, DATE_LONG), path },
  })
}
