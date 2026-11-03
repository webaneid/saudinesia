import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { linkCard, pilgrimBookingState, unlinkCard, type LinkResult } from '@/lib/pilgrims/bookingLink'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { badRequest, cardIdSchema, closedBooking, ipLimited, notFound, parseBody, routeFailure, serviceFailure } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }

// Jamaah memakai data dari "Jamaah Saya" untuk jamaah di booking MILIKNYA (docs/arsitektur-jamaah.md §5.5, Fase 7b). Pemilik = sesi: booking,
// jamaah, atau kartu akun lain → 404 yang sama dengan "tidak ada" (diperiksa lib/pilgrims/bookingLink.ts). PUT = tautkan / perbarui dari kartu.
const bodySchema = z.object({ cardId: z.string().uuid('Pilih jamaah dari Jamaah Saya') }).strict()

async function ids(params: Ctx['params']) {
  const p = await params
  const b = cardIdSchema.safeParse(p.id)
  const bp = cardIdSchema.safeParse(p.pilgrimId)
  return b.success && bp.success ? { bookingId: b.data, pilgrimId: bp.data } : null
}

const respond = (r: LinkResult) => (r.ok ? NextResponse.json(ok({ savedPilgrimId: r.savedPilgrimId })) : serviceFailure(r))

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const refusal = await onboardingRefusal(actor.userId, actor.role)
    if (refusal) return refusal
    const k = await ids(params)
    if (!k) return notFound()
    const limited = await ipLimited(req)
    if (limited) return limited
    const parsed = bodySchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    if ((await pilgrimBookingState(k.bookingId, actor.userId)) === 'closed') return closedBooking()
    return respond(await linkCard(actor, k.bookingId, k.pilgrimId, parsed.data.cardId))
  } catch (e) {
    return routeFailure(e, 'bookings/pilgrims/card/PUT')
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const k = await ids(params)
    if (!k) return notFound()
    const limited = await ipLimited(req)
    if (limited) return limited
    return respond(await unlinkCard(actor, k.bookingId, k.pilgrimId))
  } catch (e) {
    return routeFailure(e, 'bookings/pilgrims/card/DELETE')
  }
}
