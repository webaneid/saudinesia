import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { documentService, listCardDocuments, tripUploadableTypes } from '@/lib/documents/service'
import { createdResponse, docFailure, docIpLimited, docNotFound, readUpload } from '@/lib/documents/http'
import { pilgrimBookingState, tripScopeOf } from '@/lib/pilgrims/bookingLink'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { cardIdSchema, closedBooking, routeFailure } from '@/lib/pilgrims/http'
import type { Actor } from '@/lib/pilgrims/service'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }

// Dokumen PER PERJALANAN (tiket, reservasi) jamaah di booking milik sesi (docs/arsitektur-jamaah.md §5.5 butir 1). Disimpan di kartu tertaut
// dengan `bookingId` booking ini; booking akun lain / belum tertaut = 404. Paspor, KTP, dll. diunggah di halaman Jamaah Saya.

async function scope(actor: Actor, params: Ctx['params']) {
  const p = await params
  const b = cardIdSchema.safeParse(p.id)
  const bp = cardIdSchema.safeParse(p.pilgrimId)
  if (!b.success || !bp.success) return null
  const s = await tripScopeOf(b.data, bp.data)
  return s && s.ownerId === actor.userId ? { ...s, bookingId: b.data } : null
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const s = await scope(actor, params)
    if (!s) return docNotFound()
    const documents = await listCardDocuments(actor, s.ownerId, s.cardId, { bookingId: s.bookingId })
    if (!documents) return docNotFound()
    return NextResponse.json(ok({ documents, types: await tripUploadableTypes(s.bookingId, s.cardId) }))
  } catch (e) {
    return routeFailure(e, 'bookings/pilgrims/documents/GET')
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const refusal = await onboardingRefusal(actor.userId, actor.role)
    if (refusal) return refusal
    const s = await scope(actor, params)
    if (!s) return docNotFound()
    if ((await pilgrimBookingState(s.bookingId, actor.userId)) === 'closed') return closedBooking()
    const limited = await docIpLimited(req)
    if (limited) return limited
    const upload = await readUpload(req)
    if (upload instanceof NextResponse) return upload
    const r = await documentService.upload(actor, s.ownerId, s.cardId, upload.fields, upload.file, { bookingId: s.bookingId })
    return r.ok ? createdResponse(r.document) : docFailure(r)
  } catch (e) {
    return routeFailure(e, 'bookings/pilgrims/documents/POST')
  }
}
