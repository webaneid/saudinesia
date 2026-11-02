import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { linkCard, unlinkCard, type LinkResult } from '@/lib/pilgrims/bookingLink'
import { badRequest, cardIdSchema, notFound, parseBody, serviceFailure } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }

// Tautan data jamaah tersimpan (kartu pelanggan) ke jamaah booking — docs/arsitektur-jamaah.md §5.3 (Fase 7a). PUT = tautkan / perbarui snapshot
// dari kartu (kartu WAJIB milik pemesan booking); DELETE = lepas (snapshot tetap). Penulis: lib/pilgrims/bookingLink.ts.
const bodySchema = z.object({ cardId: z.string().uuid('Pilih data jamaah tersimpan') }).strict()

async function ids(params: Ctx['params']) {
  const p = await params
  const b = cardIdSchema.safeParse(p.id)
  const bp = cardIdSchema.safeParse(p.pilgrimId)
  return b.success && bp.success ? { bookingId: b.data, pilgrimId: bp.data } : null
}

const respond = (r: LinkResult) => (r.ok ? NextResponse.json(ok({ savedPilgrimId: r.savedPilgrimId })) : serviceFailure(r))

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const k = await ids(params)
    if (!k) return notFound()
    const parsed = bodySchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    return respond(await linkCard({ userId: session.userId, role: session.role }, k.bookingId, k.pilgrimId, parsed.data.cardId))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/card/PUT')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const k = await ids(params)
    if (!k) return notFound()
    return respond(await unlinkCard({ userId: session.userId, role: session.role }, k.bookingId, k.pilgrimId))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/card/DELETE')
  }
}
