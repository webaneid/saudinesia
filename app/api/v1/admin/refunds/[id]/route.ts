import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { refundActionSchema } from '@/lib/validators/refunds'
import { requireRefundManage } from '@/lib/pricing/policy'
import { approveRefund, payRefund, rejectRefund, updateRefundAmount, type RefundFailure } from '@/lib/refunds/service'
import { parseCashTarget } from '@/lib/cash/accounts'
import { formatRupiah } from '@/lib/utils'

// Siklus refund (Fase 7b-2a §10.10): ubah jumlah (pending) · setujui · tolak · bayar (uang keluar + entri buku kas). Peran refund saja.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRefundManage()
    const id = z.string().uuid().safeParse((await params).id)
    if (!id.success) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const parsed = refundActionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })
    const b = parsed.data
    let r: RefundFailure | { kind: 'done' }
    if (b.action === 'approve') r = await approveRefund(id.data, session.userId)
    else if (b.action === 'reject') r = await rejectRefund(id.data, { byUserId: session.userId, notes: b.notes ?? null })
    else if (b.action === 'update') r = await updateRefundAmount(id.data, { amount: b.amount, reason: b.reason })
    else {
      const cashAccount = parseCashTarget(b.cashAccount)
      if (!cashAccount) return NextResponse.json(err('Pilih akun kas pembayar'), { status: 400 })
      r = await payRefund(id.data, { byUserId: session.userId, cashAccount, paidAt: b.paidAt, notes: b.notes ?? null })
    }
    switch (r.kind) {
      case 'not_found': return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
      case 'conflict': return NextResponse.json(err('Status refund sudah berubah — muat ulang halaman'), { status: 409 })
      case 'over_limit': return NextResponse.json(err(r.max > 0 ? `Jumlah refund paling banyak ${formatRupiah(r.max)}` : 'Tidak ada dana yang dapat dikembalikan'), { status: 422 })
      case 'needs_account': return NextResponse.json(err('Akun kas tidak aktif atau tidak ditemukan'), { status: 422 })
      case 'invalid_date': return NextResponse.json(err('Tanggal bayar tidak boleh di masa depan atau sebelum refund disetujui'), { status: 422 })
      case 'decision_pending': return NextResponse.json(err('Pembatalan ini ditahan/ditunda — putuskan dari kotak pembatalan'), { status: 409 })
      case 'done': return NextResponse.json(ok({ action: b.action }))
    }
  } catch (e) {
    return authFailureResponse(e, 'admin/refunds/[id]')
  }
}
