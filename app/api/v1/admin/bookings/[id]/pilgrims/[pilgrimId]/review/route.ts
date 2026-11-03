import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { decidePilgrim } from '@/lib/pilgrims/review'
import { REVIEW_NOTE_MAX } from '@/lib/pilgrims/reviewState'
import { badRequest, cardIdSchema, notFound, parseBody, serviceFailure } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }

// Keputusan petugas atas pengajuan data jamaah (docs/arsitektur-jamaah.md §8.4, Fase 6): `verified` (dokumen wajib diterima semua) atau
// `needs_revision` (catatan wajib, tampil ke pemesan). Penulis: lib/pilgrims/review.ts.
const bodySchema = z.object({
  decision: z.enum(['verified', 'needs_revision']),
  note: z.string().max(REVIEW_NOTE_MAX, `Catatan maksimal ${REVIEW_NOTE_MAX} karakter`).nullish(),
}).strict()

export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const p = await params
    const b = cardIdSchema.safeParse(p.id)
    const bp = cardIdSchema.safeParse(p.pilgrimId)
    if (!b.success || !bp.success) return notFound()
    const parsed = bodySchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    const r = await decidePilgrim({ userId: session.userId, role: session.role }, b.data, bp.data, parsed.data)
    return r.ok ? NextResponse.json(ok({ status: r.status })) : serviceFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/review/POST')
  }
}
