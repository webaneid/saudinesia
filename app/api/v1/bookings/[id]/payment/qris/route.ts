import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { apiErrorJson } from '@/lib/errors/api'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { claimRefusal, paymentLimits } from '@/lib/payments/limits'
import { buildDynamicQris } from '@/lib/qris/emv'
import { payableQris } from '@/lib/qris/payable'
import { qrisSvg } from '@/lib/qris/render'
import { formatRupiah } from '@/lib/utils'
import { logError } from '@/lib/log'

const querySchema = z.object({
  qris: z.uuid(),
  amount: z.string().regex(/^\d{1,10}$/).transform(Number),
}).strict()

// QR QRIS dinamis untuk satu pembayaran (Fase 8, docs/arsitektur-booking-engine-v2.md §10.11). Nominal = pokok yang diisi pelanggan (dinilai
// `paymentLimits` seperti unggah bukti) + kode unik invoice; referensi = nomor invoice. Gambar dibuat di server dari QRIS aktif saat ini (K8-2) —
// tak ada yang disimpan. Hanya pemilik booking; draf/booking lain = 404 seragam.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await params
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return apiErrorJson('qrisInvalidRequest', 400)

    const booking = await prisma.booking.findFirst({
      where: { id, userId: session.userId, status: { not: 'draft' } },
      select: {
        status: true, totalAmount: true,
        invoice: { select: { number: true, uniqueCode: true, taxAddedIdr: true, taxIncludedIdr: true } },
        payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } },
        refunds: billRefunds,
      },
    })
    if (!booking) return apiErrorJson('bookingNotFound', 404)
    if (booking.status !== 'active' || !booking.invoice) return apiErrorJson('bookingNotAwaitingPayment', 422)

    const qris = (await payableQris()).find(q => q.id === parsed.data.qris)
    if (!qris) return apiErrorJson('qrisUnavailable', 409)

    const { minimumFirstPaymentPercent } = await getInvoiceSettings()
    const refused = claimRefusal(paymentLimits(billOf(booking), minimumFirstPaymentPercent), parsed.data.amount)
    if (refused) {
      if (refused.code === 'paymentAmountBelowMin') return apiErrorJson(refused.code, 422, { params: { min: formatRupiah(refused.min) } })
      if (refused.code === 'paymentAmountAboveBalance') return apiErrorJson(refused.code, 422, { params: { max: formatRupiah(refused.max) } })
      return apiErrorJson(refused.code, 422)
    }

    const total = parsed.data.amount + (booking.invoice.uniqueCode ?? 0)
    const svg = await qrisSvg(buildDynamicQris(qris.payload, total, booking.invoice.number))
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    logError('bookings/id/payment/qris', error)
    return apiErrorJson('internal', 500)
  }
}
