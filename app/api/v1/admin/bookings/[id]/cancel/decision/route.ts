import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { cancelDecisionSchema } from '@/lib/validators/refunds'
import { requireRefundManage } from '@/lib/pricing/policy'
import { decideDeferred } from '@/lib/booking/adminCancel'
import { formatRupiah } from '@/lib/utils'

// Keputusan atas pembatalan yang ditunda (`defer`) → refund atau tahan (Fase 7b-2a §10.10). Peran refund saja.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRefundManage()
    const id = z.string().uuid().safeParse((await params).id)
    if (!id.success) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const parsed = cancelDecisionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })
    const r = await decideDeferred(id.data, { ...parsed.data, byUserId: session.userId })
    switch (r.kind) {
      case 'not_found': return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
      case 'conflict': return NextResponse.json(err('Keputusan pembatalan ini sudah diambil'), { status: 409 })
      case 'note_required': return NextResponse.json(err('Catatan wajib diisi bila uang ditahan'), { status: 422 })
      case 'over_limit': return NextResponse.json(err(`Jumlah refund harus lebih dari 0 dan paling banyak ${formatRupiah(r.max)}`), { status: 422 })
      case 'needs_force_majeure': return NextResponse.json(err(`Melebihi kebijakan pembatalan (paling banyak ${formatRupiah(r.policyCap)} tanpa force-majeure) — pilih kategori force-majeure`), { status: 422 })
      case 'force_majeure_not_applicable': return NextResponse.json(err('Force-majeure hanya bersama keputusan refund'), { status: 422 })
      case 'done': return NextResponse.json(ok({ refundId: r.refundId }))
    }
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/cancel/decision')
  }
}
