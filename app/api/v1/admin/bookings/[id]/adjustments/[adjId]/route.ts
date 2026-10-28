import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { adjustmentReasonSchema } from '@/lib/validators/adjustments'
import { requireBookingAdjust } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { AdjustmentError, updateAdjustmentReason } from '@/lib/booking/adjustments'

type Ctx = { params: Promise<{ id: string; adjId: string }> }

// Ubah HANYA catatan alasan (internal) penyesuaian lama. Label/jumlah beku di invoice — untuk mengubahnya, batalkan lalu atur total lagi.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingAdjust()
    const { id, adjId } = await params
    const parsed = adjustmentReasonSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const result = await updateAdjustmentReason({ bookingId: id, adjustmentId: adjId, reason: parsed.data.reason, byUserId: session.userId })
    return NextResponse.json(ok(result)) // siapa/kapan tersimpan di baris (SEC-101); isi catatan tak pernah dilog (bisa memuat nama)
  } catch (e) {
    if (e instanceof AdjustmentError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/bookings/adjustments/PATCH')
  }
}
