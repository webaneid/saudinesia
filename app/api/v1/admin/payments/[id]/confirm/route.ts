import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { notify } from '@/lib/notifications/notify'
import { z } from 'zod'
import { PaymentAmountError } from '@/lib/payments/confirmAmount'
import { processPayment } from '@/lib/payments/process'

// `amount` = jumlah yang benar-benar diterima (bawaan: total pesanan); kurang dari total ditolak, lebih dari total wajib bercatatan (lib/payments/confirmAmount.ts).
// Pemrosesan (kunci booking, status dibaca ulang, kuota) ada di lib/payments/process.ts.
const schema = z.object({ action: z.enum(['confirm', 'reject']), notes: z.string().max(500).optional(), amount: z.number().positive().optional() }).strict()

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin()
    const { id }  = await params
    const parsed  = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err('Input tidak valid'), { status: 400 })
    const { action } = parsed.data

    const result = await processPayment(id, { action, amount: parsed.data.amount, notes: parsed.data.notes, byUserId: session.userId })
    if (result.kind === 'not_found') return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    if (result.kind === 'conflict') return NextResponse.json(err('Pembayaran ini sudah diproses atau pesanan tidak sedang menunggu verifikasi pembayaran'), { status: 409 })
    // Best-effort setelah transaksi commit, tidak memblokir respons; notify() tidak pernah melempar dan mencatat status jujur per kanal.
    void notify({ userId: result.userId, bookingId: result.bookingId, event: { type: action === 'confirm' ? 'payment_confirmed' : 'payment_rejected', code: result.code } })

    return NextResponse.json(ok({ action }))
  } catch (e) {
    if (e instanceof PaymentAmountError) return NextResponse.json(err(e.message), { status: 400 })
    if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/payments/confirm]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
