import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { sendInvoiceNotification } from '@/lib/invoice/notifyInvoice'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

// "Kirim ulang invoice" (P2): email + WhatsApp terverifikasi berisi tautan invoice TERKINI. Dibatasi per booking (tiap kirim = pesan ke pelanggan); tanpa dedupe (memang dikirim ulang).
export async function POST(_req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id } = await params
    const limit = await consume(policy('invoiceSendBooking', id))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)
    const sent = await sendInvoiceNotification(id, { dedupe: false })
    if (!sent) return NextResponse.json(err('Invoice tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok({ sent: true }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/invoice-link/send')
  }
}
