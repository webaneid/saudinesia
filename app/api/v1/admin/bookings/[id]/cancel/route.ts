import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { adminCancelSchema } from '@/lib/validators/refunds'
import { canManageRefund, requireBookingCancel } from '@/lib/pricing/policy'
import { cancelByAdmin } from '@/lib/booking/adminCancel'
import { notify } from '@/lib/notifications/notify'
import { formatRupiah } from '@/lib/utils'

// Pembatalan oleh staf (Fase 7b-2a §10.10). Semua admin boleh membatalkan pesanan TANPA uang masuk; uang masuk → hanya peran refund (manager/superadmin).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireBookingCancel()
    const id = z.string().uuid().safeParse((await params).id)
    if (!id.success) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const parsed = adminCancelSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })
    const r = await cancelByAdmin(id.data, { ...parsed.data, byUserId: session.userId, canMoney: canManageRefund(session.role) })
    switch (r.kind) {
      case 'not_found': return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
      case 'conflict': return NextResponse.json(err('Hanya pesanan aktif yang dapat dibatalkan'), { status: 409 })
      case 'pending_payment': return NextResponse.json(err('Ada bukti transfer menunggu verifikasi — proses dulu pembayarannya'), { status: 409 })
      case 'forbidden_money': return NextResponse.json(err('Pesanan ini sudah menerima pembayaran — pembatalan hanya oleh manager/superadmin'), { status: 403 })
      case 'decision_required': return NextResponse.json({ ...err('Pilih keputusan atas uang yang sudah masuk'), meta: { paid: r.paid, suggested: r.suggested } }, { status: 422 })
      case 'amount_required': return NextResponse.json(err('Saran kebijakan refund Rp 0 — isi jumlah refund (di atas kebijakan wajib force-majeure) atau pilih tahan uang'), { status: 422 })
      case 'note_required': return NextResponse.json(err('Catatan wajib diisi bila uang ditahan'), { status: 422 })
      case 'over_limit': return NextResponse.json(err(`Jumlah refund harus lebih dari 0 dan paling banyak ${formatRupiah(r.max)}`), { status: 422 })
      case 'needs_force_majeure': return NextResponse.json(err(`Melebihi kebijakan pembatalan (paling banyak ${formatRupiah(r.policyCap)} tanpa force-majeure) — pilih kategori force-majeure`), { status: 422 })
      case 'force_majeure_not_applicable': return NextResponse.json(err('Force-majeure hanya bersama keputusan refund'), { status: 422 })
      case 'done':
        void notify({ userId: r.userId, bookingId: id.data, event: { type: 'booking_cancelled', code: r.code, money: r.paid > 0 } })
        return NextResponse.json(ok({ decision: r.decision, refundId: r.refundId }))
    }
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/cancel')
  }
}
