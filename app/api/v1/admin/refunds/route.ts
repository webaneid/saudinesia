import { NextResponse } from 'next/server'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { refundCreateSchema } from '@/lib/validators/refunds'
import { requireRefundManage } from '@/lib/pricing/policy'
import { proposeRefund } from '@/lib/refunds/service'
import { refundFailureResponse } from '@/lib/refunds/http'

// Buat refund dari halaman Keuangan → Refund (§10.13; force-majeure dinilai layanan — docs/rencana-force-majeure.md): kelebihan bayar pada booking hidup, atau sisa uang pada booking batal. Batas dinilai di dalam kunci booking.
export async function POST(req: Request) {
  try {
    const session = await requireRefundManage()
    const parsed = refundCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })
    const { bookingId, ...input } = parsed.data
    const r = await proposeRefund(bookingId, { ...input, byUserId: session.userId })
    if (r.kind !== 'done') return refundFailureResponse(r)
    return NextResponse.json(ok({ id: r.refundId }), { status: 201 })
  } catch (e) {
    return authFailureResponse(e, 'admin/refunds')
  }
}
