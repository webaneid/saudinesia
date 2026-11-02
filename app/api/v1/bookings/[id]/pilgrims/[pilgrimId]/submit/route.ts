import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { pilgrimBookingState } from '@/lib/pilgrims/bookingLink'
import { submitPilgrim } from '@/lib/pilgrims/review'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { cardIdSchema, closedBooking, ipLimited, notFound, routeFailure, serviceFailure } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }

// Pemesan mengajukan data jamaah di booking MILIKNYA untuk diperiksa petugas (docs/arsitektur-jamaah.md §8.4, Fase 6). Tanpa badan; pemilik = sesi
// (booking/jamaah akun lain → 404 yang sama). Aturan transisi dan kelengkapan di lib/pilgrims/review.ts.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const refusal = await onboardingRefusal(actor.userId, actor.role)
    if (refusal) return refusal
    const p = await params
    const b = cardIdSchema.safeParse(p.id)
    const bp = cardIdSchema.safeParse(p.pilgrimId)
    if (!b.success || !bp.success) return notFound()
    const limited = await ipLimited(req)
    if (limited) return limited
    if ((await pilgrimBookingState(b.data, actor.userId)) === 'closed') return closedBooking()
    const r = await submitPilgrim(actor, b.data, bp.data)
    return r.ok ? NextResponse.json(ok({ status: r.status })) : serviceFailure(r)
  } catch (e) {
    return routeFailure(e, 'bookings/pilgrims/submit/POST')
  }
}
