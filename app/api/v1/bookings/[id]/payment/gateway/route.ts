import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { onboardingRefusal } from '@/lib/auth/contact'
import { clientIp, consume, policy } from '@/lib/auth/rateLimit'
import { ok } from '@/lib/validators'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'
import { createGatewayPayment } from '@/lib/payments/gateway'
import { gatewayView, gatewayViewSelect } from '@/lib/payments/gatewayView'
import { formatRupiah } from '@/lib/utils'

// Bayar online lewat iPaymu (Fase 9, docs/arsitektur-booking-engine-v2.md §10.12 langkah 4): pemilik booking memilih kanal + nominal; biaya layanan dan
// batas nominal dihitung server di dalam kunci booking (lib/payments/gateway.ts). Respons = nomor VA / QR / tautan bayar untuk ditampilkan di halaman kita.
const schema = z.object({
  amount: z.number().int().positive().max(10_000_000_000),
  channel: z.string().regex(/^[a-z0-9_-]{1,40}:[a-z0-9_-]{1,40}$/),
}).strict()

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
    const { id } = await params
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return zodFailure(parsed.error)
    for (const p of [policy('gatewayPayUser', session.userId), policy('gatewayPayUser', `ip:${clientIp(request) ?? 'unknown'}`)]) {
      const hit = await consume(p)
      if (!hit.allowed) { const res = apiErrorJson('tooManyPaymentRequests', 429); res.headers.set('Retry-After', String(hit.retryAfterSec)); return res }
    }

    const r = await createGatewayPayment({ bookingId: id, userId: session.userId, amount: parsed.data.amount, channelId: parsed.data.channel })
    switch (r.kind) {
      case 'not_found': return apiErrorJson('bookingNotFound', 404)
      case 'unavailable': return apiErrorJson('onlinePaymentUnavailable', 409)
      case 'channel': return apiErrorJson('onlinePaymentChannel', 400, { field: 'channel' })
      case 'closed': return apiErrorJson('bookingNotAwaitingPayment', 422)
      case 'busy': return apiErrorJson('onlinePaymentBusy', 409)
      case 'gateway': return apiErrorJson('onlinePaymentFailed', 502)
      case 'refused': {
        const f = r.refusal
        if (f.code === 'paymentAmountBelowMin') return apiErrorJson(f.code, 422, { field: 'amount', params: { min: formatRupiah(f.min) } })
        if (f.code === 'paymentAmountAboveBalance') return apiErrorJson(f.code, 422, { field: 'amount', params: { max: formatRupiah(f.max) } })
        return apiErrorJson(f.code, 422)
      }
    }
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: r.paymentId }, select: gatewayViewSelect })
    return NextResponse.json(ok(await gatewayView(row)), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    console.error('[bookings/id/payment/gateway]', error instanceof Error ? error.name : 'galat')
    return apiErrorJson('internal', 500)
  }
}
