import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { bookingRevisionSchema } from '@/lib/validators/booking'
import { requireBookingManage } from '@/lib/booking/policy'
import { previewRevision, revisionFailure, revisionPartialTotals } from '@/lib/booking/revise'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

// Pratinjau revisi = mesin revisi yang SAMA di transaksi yang selalu dibatalkan (lib/booking/revise.ts): angka, baris invoice, perubahan, pelanggaran, galat kuota identik dengan simpan.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const { id } = await params
    const parsed = bookingRevisionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    try {
      return NextResponse.json(ok(await previewRevision(id, parsed.data, session.userId)))
    } catch (e) {
      const f = revisionFailure(e)
      if (!f) throw e
      // Satu baris gagal → subtotal baris lain tetap dihitung (tanpa baris itu) untuk editor; ringkasan tetap tak ditampilkan.
      const itemTotals = f.itemIndex !== undefined ? await revisionPartialTotals(id, parsed.data, session.userId, f.itemIndex) : undefined
      return NextResponse.json({ success: false, error: f.error, ...((f.violations || f.itemIndex !== undefined) && { meta: { violations: f.violations ?? [], ...(f.itemIndex !== undefined && { itemIndex: f.itemIndex, itemTotals }) } }) }, { status: f.status })
    }
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/revision/preview')
  }
}
