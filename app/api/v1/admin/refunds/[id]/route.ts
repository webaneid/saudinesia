import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { refundActionSchema } from '@/lib/validators/refunds'
import { requireRefundManage } from '@/lib/pricing/policy'
import { approveRefund, payRefund, rejectRefund, updateRefundAmount, type RefundFailure } from '@/lib/refunds/service'
import { refundFailureResponse } from '@/lib/refunds/http'
import { parseCashTarget } from '@/lib/cash/accounts'

// Siklus refund (Fase 7b-2a §10.10, halaman detail §10.13): ubah (pending: jumlah/alasan/rekening tujuan) · setujui · tolak · bayar (uang keluar + entri
// buku kas; rekening tujuan wajib kecuali tunai). Peran refund saja; force-majeure + persetujuan superadmin dinilai layanan (docs/rencana-force-majeure.md).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRefundManage()
    const id = z.string().uuid().safeParse((await params).id)
    if (!id.success) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const parsed = refundActionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })
    const b = parsed.data
    let r: RefundFailure | { kind: 'done' }
    if (b.action === 'approve') r = await approveRefund(id.data, session.userId, { isSuperadmin: session.role === 'superadmin' })
    else if (b.action === 'reject') r = await rejectRefund(id.data, { byUserId: session.userId, notes: b.notes ?? null })
    else if (b.action === 'update') r = await updateRefundAmount(id.data, { amount: b.amount, reason: b.reason, ...(b.recipient !== undefined ? { recipient: b.recipient } : {}), ...(b.forceMajeure !== undefined ? { forceMajeure: b.forceMajeure } : {}) })
    else {
      const cashAccount = parseCashTarget(b.cashAccount)
      if (!cashAccount) return NextResponse.json(err('Pilih akun kas pembayar'), { status: 400 })
      r = await payRefund(id.data, { byUserId: session.userId, cashAccount, paidAt: b.paidAt, notes: b.notes ?? null, recipient: b.recipient ?? null })
    }
    if (r.kind !== 'done') return refundFailureResponse(r)
    return NextResponse.json(ok({ action: b.action }))
  } catch (e) {
    return authFailureResponse(e, 'admin/refunds/[id]')
  }
}
