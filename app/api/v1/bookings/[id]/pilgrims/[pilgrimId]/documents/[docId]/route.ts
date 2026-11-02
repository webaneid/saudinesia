import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { documentService } from '@/lib/documents/service'
import { docFailure, docIdSchema, docIpLimited, docNotFound } from '@/lib/documents/http'
import { tripScopeOf } from '@/lib/pilgrims/bookingLink'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { cardIdSchema, routeFailure } from '@/lib/pilgrims/http'
import type { Actor } from '@/lib/pilgrims/service'

type Ctx = { params: Promise<{ id: string; pilgrimId: string; docId: string }> }

// Lihat (URL presigned) / hapus satu dokumen per perjalanan jamaah di booking milik sesi (docs/arsitektur-jamaah.md §5.5 butir 1).
async function scope(actor: Actor, params: Ctx['params']) {
  const p = await params
  const b = cardIdSchema.safeParse(p.id)
  const bp = cardIdSchema.safeParse(p.pilgrimId)
  const doc = docIdSchema.safeParse(p.docId)
  if (!b.success || !bp.success || !doc.success) return null
  const s = await tripScopeOf(b.data, bp.data)
  return s && s.ownerId === actor.userId ? { ...s, bookingId: b.data, docId: doc.data } : null
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const s = await scope(actor, params)
    if (!s) return docNotFound()
    const r = await documentService.previewUrl(actor, s.ownerId, s.cardId, s.docId, { bookingId: s.bookingId })
    if (!r.ok) return docFailure(r)
    return NextResponse.json(ok({ url: r.url, mimeType: r.mimeType }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return routeFailure(e, 'bookings/pilgrims/documents/[docId]/GET')
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const s = await scope(actor, params)
    if (!s) return docNotFound()
    const limited = await docIpLimited(req)
    if (limited) return limited
    const r = await documentService.remove(actor, s.ownerId, s.cardId, s.docId, { bookingId: s.bookingId })
    return r.ok ? NextResponse.json(ok({ deleted: true })) : docFailure(r)
  } catch (e) {
    return routeFailure(e, 'bookings/pilgrims/documents/[docId]/DELETE')
  }
}
