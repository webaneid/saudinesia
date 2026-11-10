import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { documentService, listCardDocuments, tripUploadableTypes } from '@/lib/documents/service'
import { createdResponse, docFailure, docNotFound, readUpload } from '@/lib/documents/http'
import { tripScopeOf } from '@/lib/pilgrims/bookingLink'
import { cardIdSchema } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }

// Dokumen PER PERJALANAN (tiket, reservasi — jenis non-reusable) seorang jamaah booking, dikelola staf (docs/arsitektur-jamaah.md §5.3 butir 4).
// Disimpan di kartu tertaut dengan `bookingId` booking ini; jamaah tanpa kartu tertaut = 404. Dokumen milik orang (paspor, KTP) dikelola di kartu.

async function scope(params: Ctx['params']) {
  const p = await params
  const b = cardIdSchema.safeParse(p.id)
  const bp = cardIdSchema.safeParse(p.pilgrimId)
  if (!b.success || !bp.success) return null
  const s = await tripScopeOf(b.data, bp.data)
  return s ? { ...s, bookingId: b.data } : null
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const s = await scope(params)
    if (!s) return docNotFound()
    const documents = await listCardDocuments({ userId: session.userId, role: session.role }, s.ownerId, s.cardId, { bookingId: s.bookingId })
    if (!documents) return docNotFound()
    return NextResponse.json(ok({ documents, types: await tripUploadableTypes(s.bookingId, s.cardId) }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/documents/GET')
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const s = await scope(params)
    if (!s) return docNotFound()
    const upload = await readUpload(req)
    if (upload instanceof NextResponse) return upload
    const r = await documentService.upload({ userId: session.userId, role: session.role }, s.ownerId, s.cardId, upload.fields, upload.file, { bookingId: s.bookingId })
    return r.ok ? createdResponse(r.document) : docFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/documents/POST')
  }
}
