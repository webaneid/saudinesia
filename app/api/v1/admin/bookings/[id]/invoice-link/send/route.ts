import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
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
    const b = await prisma.booking.findUnique({ where: { id }, select: { status: true } })
    if (!b) return NextResponse.json(err('Invoice tidak ditemukan'), { status: 404 })
    // Booking batal/hangus/selesai: jangan meminta pelanggan membayar lagi.
    if (b.status !== 'active') return NextResponse.json(err('Booking tidak aktif — invoice tidak dikirim ulang'), { status: 409 })
    const limit = await consume(policy('invoiceSendBooking', id))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)
    const outcomes = await sendInvoiceNotification(id, { dedupe: false })
    if (!outcomes) return NextResponse.json(err('Invoice tidak ditemukan'), { status: 404 })
    // Hasil per kanal → admin tahu kapan harus menyalin tautan sendiri (mis. email/WhatsApp pelanggan belum terverifikasi).
    return NextResponse.json(ok({ channels: outcomes }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/invoice-link/send')
  }
}
