import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { previewDraft } from '@/lib/booking/drafts'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

// Pratinjau = simulasi terbit yang di-rollback (lib/booking/drafts.ts). POST karena menjalankan mesin pesan (kunci + tulis yang dibatalkan), bukan bacaan murni.
export async function POST(_req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id } = await params
    const r = await previewDraft(id)
    if (!r.ok) return NextResponse.json({ success: false, error: r.message, ...(r.violations && { meta: { violations: r.violations } }) }, { status: r.status })
    return NextResponse.json(ok(r.preview))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/drafts/[id]/preview')
  }
}
