import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { refundProposeSchema } from '@/lib/validators/refunds'
import { requireRefundManage } from '@/lib/pricing/policy'
import { proposeRefund } from '@/lib/refunds/service'
import { formatRupiah } from '@/lib/utils'

// Usulan refund (Fase 7b-2a §10.10): kelebihan bayar pada booking hidup, atau sisa uang pada booking batal. Batas dinilai di dalam kunci booking.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRefundManage()
    const id = z.string().uuid().safeParse((await params).id)
    if (!id.success) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const parsed = refundProposeSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })
    const r = await proposeRefund(id.data, { ...parsed.data, byUserId: session.userId })
    if (r.kind === 'not_found') return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    if (r.kind === 'over_limit') return NextResponse.json(err(r.max > 0 ? `Jumlah refund paling banyak ${formatRupiah(r.max)}` : 'Tidak ada dana yang dapat dikembalikan'), { status: 422 })
    if (r.kind === 'decision_pending') return NextResponse.json(err('Pembatalan ini ditahan/ditunda — putuskan dari kotak pembatalan'), { status: 409 })
    if (r.kind !== 'done') return NextResponse.json(err('Refund tidak dapat dibuat'), { status: 409 })
    return NextResponse.json(ok({ refundId: r.refundId }), { status: 201 })
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/refunds')
  }
}
