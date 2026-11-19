import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { onboardingRefusal } from '@/lib/auth/contact'
import { consume, policy } from '@/lib/auth/rateLimit'
import { ok } from '@/lib/validators'
import { apiErrorJson } from '@/lib/errors/api'
import { syncAndNotify } from '@/lib/payments/gateway'
import { gatewayView, gatewayViewSelect } from '@/lib/payments/gatewayView'
import { logError } from '@/lib/log'

// "Periksa status" pembayaran online oleh pemilik booking: status dibaca dari iPaymu (/transaction), lalu dikonfirmasi otomatis bila lunas.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const session = await requireSession()
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
    const { id, paymentId } = await params
    if (!/^[0-9a-f-]{36}$/.test(paymentId)) return apiErrorJson('bookingNotFound', 404)
    const owned = await prisma.payment.findFirst({ where: { id: paymentId, bookingId: id, gateway: { not: null }, booking: { userId: session.userId, status: { not: 'draft' } } }, select: { id: true } })
    if (!owned) return apiErrorJson('bookingNotFound', 404)
    const hit = await consume(policy('gatewayCheckUser', session.userId))
    if (!hit.allowed) { const res = apiErrorJson('tooManyPaymentRequests', 429); res.headers.set('Retry-After', String(hit.retryAfterSec)); return res }
    await syncAndNotify(paymentId)
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: gatewayViewSelect })
    return NextResponse.json(ok(await gatewayView(row)), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    logError('bookings/id/payment/gateway/check', error)
    return apiErrorJson('internal', 500)
  }
}
