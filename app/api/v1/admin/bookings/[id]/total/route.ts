import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { bookingTotalSetSchema } from '@/lib/validators/adjustments'
import { requireBookingAdjust } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { AdjustmentError, setBookingTotal } from '@/lib/booking/adjustments'

type Ctx = { params: Promise<{ id: string }> }

// Atur TOTAL harga jual pesanan yang menunggu pembayaran (nego/diskon). Berapa pun total > 0 diterima — di bawah rekomendasi/HPP hanya mengembalikan peringatan INTERNAL (`warningAfter`), tak pernah menolak.
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingAdjust()
    const { id } = await params
    const parsed = bookingTotalSetSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const result = await setBookingTotal({ bookingId: id, ...parsed.data, byUserId: session.userId })
    return NextResponse.json(ok(result))
  } catch (e) {
    if (e instanceof AdjustmentError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/bookings/total/PUT')
  }
}
