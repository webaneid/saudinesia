import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { bookingRevisionSchema } from '@/lib/validators/booking'
import { requireBookingManage } from '@/lib/booking/policy'
import { reviseBooking, revisionEditorState, revisionFailure } from '@/lib/booking/revise'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

// Revisi booking terbit (docs/arsitektur-booking-engine-v2.md §10.4 6b): GET = isi editor (item & jamaah sekarang, mana yang terkunci R3), PUT = simpan revisi.
// Tanpa notifikasi ke pelanggan (D13). Harga hanya dihitung server; satu-satunya angka dari klien = harga khusus item (R4, catatan wajib).
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id } = await params
    const state = await revisionEditorState(id)
    if (!state) return NextResponse.json(err('Booking tidak ditemukan atau tidak dapat diedit'), { status: 404 })
    return NextResponse.json(ok(state))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/revision/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const { id } = await params
    const parsed = bookingRevisionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    try {
      const r = await reviseBooking(id, parsed.data, session.userId)
      return NextResponse.json(ok(r))
    } catch (e) {
      const f = revisionFailure(e)
      if (!f) throw e
      return NextResponse.json({ success: false, error: f.error, ...((f.violations || f.itemIndex !== undefined) && { meta: { violations: f.violations ?? [], ...(f.itemIndex !== undefined && { itemIndex: f.itemIndex }) } }) }, { status: f.status })
    }
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/revision/PUT')
  }
}
