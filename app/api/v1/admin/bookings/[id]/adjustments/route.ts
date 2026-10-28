import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { adjustmentCreateSchema } from '@/lib/validators/adjustments'
import { requireBookingAdjust, requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { AdjustmentError, adjustBookingTotal, listAdjustments } from '@/lib/booking/adjustments'

type Ctx = { params: Promise<{ id: string }> }

// Riwayat penyesuaian total pesanan (INTERNAL — memuat catatan alasan). Peran: policy harga.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requirePricingView()
    const { id } = await params
    return NextResponse.json(ok(await listAdjustments(id)))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/adjustments/GET')
  }
}

// Diskon (negatif) / biaya tambahan (positif) pada total pesanan yang menunggu pembayaran. Catatan alasan wajib bila total akhir di bawah HPP awal.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingAdjust()
    const { id } = await params
    const parsed = adjustmentCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const result = await adjustBookingTotal({ bookingId: id, ...parsed.data, byUserId: session.userId })
    return NextResponse.json(ok(result), { status: 201 })
  } catch (e) {
    if (e instanceof AdjustmentError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/bookings/adjustments/POST')
  }
}
