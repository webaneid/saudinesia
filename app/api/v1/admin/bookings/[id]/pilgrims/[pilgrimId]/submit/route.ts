import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { submitPilgrim } from '@/lib/pilgrims/review'
import { cardIdSchema, notFound, serviceFailure } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }

// Staf mengajukan data jamaah atas nama pemesan (docs/arsitektur-jamaah.md §8.4, Fase 6). Penulis: lib/pilgrims/review.ts.
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const p = await params
    const b = cardIdSchema.safeParse(p.id)
    const bp = cardIdSchema.safeParse(p.pilgrimId)
    if (!b.success || !bp.success) return notFound()
    const r = await submitPilgrim({ userId: session.userId, role: session.role }, b.data, bp.data)
    return r.ok ? NextResponse.json(ok({ status: r.status })) : serviceFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/submit/POST')
  }
}
