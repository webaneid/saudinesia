import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { consume, policy } from '@/lib/auth/rateLimit'
import { ok } from '@/lib/validators'
import { apiErrorJson } from '@/lib/errors/api'
import { cancelGatewayPayment } from '@/lib/payments/gateway'
import { logError } from '@/lib/log'

// Pelanggan membatalkan pembayaran online yang masih menunggu (K9-3: satu aktif per booking) supaya bisa membuat yang baru.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const session = await requireSession()
    const { paymentId } = await params
    if (!/^[0-9a-f-]{36}$/.test(paymentId)) return apiErrorJson('bookingNotFound', 404)
    const hit = await consume(policy('gatewayPayUser', session.userId))
    if (!hit.allowed) { const res = apiErrorJson('tooManyPaymentRequests', 429); res.headers.set('Retry-After', String(hit.retryAfterSec)); return res }
    const r = await cancelGatewayPayment(paymentId, session.userId)
    if (r === 'not_found') return apiErrorJson('bookingNotFound', 404)
    if (r === 'conflict') return apiErrorJson('onlinePaymentNotAwaiting', 409)
    return NextResponse.json(ok({ cancelled: true }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    logError('bookings/id/payment/gateway/id', error)
    return apiErrorJson('internal', 500)
  }
}
