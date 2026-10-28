import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { adjustmentReverseSchema } from '@/lib/validators/adjustments'
import { requireBookingAdjust } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { AdjustmentError, reverseAdjustment } from '@/lib/booking/adjustments'

type Ctx = { params: Promise<{ id: string; adjId: string }> }

// Batalkan satu penyesuaian lewat baris pembalik (jumlah berlawanan). Hanya saat pesanan menunggu pembayaran.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingAdjust()
    const { id, adjId } = await params
    const parsed = adjustmentReverseSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const result = await reverseAdjustment({ bookingId: id, adjustmentId: adjId, reason: parsed.data.reason, byUserId: session.userId })
    return NextResponse.json(ok(result), { status: 201 })
  } catch (e) {
    if (e instanceof AdjustmentError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/bookings/adjustments/reverse/POST')
  }
}
