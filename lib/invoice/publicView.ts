import { prisma } from '@/lib/db'
import { consume, policy } from '@/lib/auth/rateLimit'
import { buildInvoiceData, invoiceBookingInclude, type InvoiceData } from '@/lib/pdf/invoiceData'
import { resolveInvoiceToken } from './link'

// Pemuat invoice PUBLIK (halaman `/invoice/[token]` dan PDF-nya, docs/arsitektur-booking-engine-v2.md §10.4 6c): batas laju per IP lalu per token SEBELUM query,
// token diperiksa (lib/invoice/link.ts), data = bentuk invoice yang sama dengan PDF (harga jual beku saja; HPP/catatan staf tak pernah ada di `InvoiceData`).
export type PublicInvoice =
  | { kind: 'ok'; data: InvoiceData; bookingId: string }
  | { kind: 'not_found' }
  | { kind: 'limited'; retryAfterSec: number }

export async function loadPublicInvoice(token: string, ip: string | null): Promise<PublicInvoice> {
  if (ip) {
    const byIp = await consume(policy('invoicePublicIp', ip))
    if (!byIp.allowed) return { kind: 'limited', retryAfterSec: byIp.retryAfterSec }
  }
  const byToken = await consume(policy('invoicePublicToken', token.slice(0, 120)))
  if (!byToken.allowed) return { kind: 'limited', retryAfterSec: byToken.retryAfterSec }
  const found = await resolveInvoiceToken(token)
  if (!found) return { kind: 'not_found' }
  const booking = await prisma.booking.findUnique({ where: { id: found.bookingId }, include: invoiceBookingInclude })
  if (!booking) return { kind: 'not_found' }
  return { kind: 'ok', data: await buildInvoiceData(booking), bookingId: booking.id }
}
