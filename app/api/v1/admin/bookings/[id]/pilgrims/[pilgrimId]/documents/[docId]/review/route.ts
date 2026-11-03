import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { reviewDocument, reviewPreviewUrl } from '@/lib/documents/review'
import { docFailure, docIdSchema, docNotFound } from '@/lib/documents/http'
import { badRequest, cardIdSchema, parseBody } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string; docId: string }> }

// Petugas menerima/menolak satu dokumen jamaah booking (docs/arsitektur-jamaah.md §8.4 butir 3, Fase 6) — dokumen orang di kartu tertaut atau
// dokumen perjalanan booking ini. Menolak dokumen yang dipakai pengajuan aktif membukanya ulang. Penulis: lib/documents/review.ts.
const bodySchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  rejectReason: z.enum(['not_matching', 'expired', 'unreadable', 'other']).nullish(),
  note: z.string().max(1000, 'Catatan maksimal 1000 karakter').nullish(),
}).strict()

async function ids(params: Ctx['params']) {
  const p = await params
  const b = cardIdSchema.safeParse(p.id)
  const bp = cardIdSchema.safeParse(p.pilgrimId)
  const d = docIdSchema.safeParse(p.docId)
  return b.success && bp.success && d.success ? { bookingId: b.data, pilgrimId: bp.data, docId: d.data } : null
}

/** Lihat berkas yang diperiksa (URL presigned 15 menit, no-store). */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const k = await ids(params)
    if (!k) return docNotFound()
    const r = await reviewPreviewUrl({ userId: session.userId, role: session.role }, k.bookingId, k.pilgrimId, k.docId)
    if (!r.ok) return docFailure(r)
    return NextResponse.json(ok({ url: r.url, mimeType: r.mimeType }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/documents/review/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const k = await ids(params)
    if (!k) return docNotFound()
    const parsed = bodySchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    const r = await reviewDocument({ userId: session.userId, role: session.role }, k.bookingId, k.pilgrimId, k.docId, parsed.data)
    return r.ok ? NextResponse.json(ok({ status: r.status })) : docFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/documents/review/PUT')
  }
}
