import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { resendNotification, resendTarget, type ResendRefusal } from '@/lib/notifications/resend'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

const REFUSAL: Record<ResendRefusal, { status: number; message: string }> = {
  not_found:      { status: 404, message: 'Log notifikasi tidak ditemukan' },
  not_resendable: { status: 422, message: 'Jenis notifikasi ini tidak bisa dikirim ulang' },
  no_booking:     { status: 422, message: 'Notifikasi ini tidak terkait booking' },
  inactive:       { status: 409, message: 'Booking tidak aktif — notifikasi tidak dikirim ulang' },
  not_applicable: { status: 409, message: 'Keadaan booking sekarang tidak cocok dengan notifikasi ini (mis. sudah lunas atau sudah berangkat)' },
}
const refuse = (r: ResendRefusal) => NextResponse.json(err(REFUSAL[r].message), { status: REFUSAL[r].status })

// Kirim ulang dari Log Notifikasi (docs/arsitektur-notifikasi.md §14): disusun ulang dari data booking TERKINI, email + WhatsApp lewat notify(). Semua peran admin (N4).
export async function POST(_req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id } = await params
    if (!z.uuid().safeParse(id).success) return refuse('not_found')
    const target = await resendTarget(id)
    if (!target.ok) return refuse(target.reason)
    // Tiap kirim = pesan ke pelanggan: dibatasi per booking.
    const limit = await consume(policy('notificationResendBooking', target.bookingId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)
    const r = await resendNotification(target.bookingId, target.type)
    if (!r.ok) return refuse(r.reason)
    return NextResponse.json(ok({ channels: r.channels }))
  } catch (e) {
    return authFailureResponse(e, 'admin/notifications/[id]/resend')
  }
}
