import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { documentService } from '@/lib/documents/service'
import { docFailure, docIdSchema, docNotFound } from '@/lib/documents/http'
import { tripScopeOf } from '@/lib/pilgrims/bookingLink'
import { cardIdSchema } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string; docId: string }> }

async function scope(params: Ctx['params']) {
  const p = await params
  const b = cardIdSchema.safeParse(p.id)
  const bp = cardIdSchema.safeParse(p.pilgrimId)
  const doc = docIdSchema.safeParse(p.docId)
  if (!b.success || !bp.success || !doc.success) return null
  const s = await tripScopeOf(b.data, bp.data)
  return s ? { ...s, bookingId: b.data, docId: doc.data } : null
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const s = await scope(params)
    if (!s) return docNotFound()
    const r = await documentService.previewUrl({ userId: session.userId, role: session.role }, s.ownerId, s.cardId, s.docId, { bookingId: s.bookingId })
    if (!r.ok) return docFailure(r)
    return NextResponse.json(ok({ url: r.url, mimeType: r.mimeType }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/documents/[docId]/GET')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const s = await scope(params)
    if (!s) return docNotFound()
    const r = await documentService.remove({ userId: session.userId, role: session.role }, s.ownerId, s.cardId, s.docId, { bookingId: s.bookingId })
    return r.ok ? NextResponse.json(ok({ deleted: true })) : docFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/documents/[docId]/DELETE')
  }
}
