import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { requireSession } from '@/lib/auth/session'
import { checkoutCartSchema } from '@/lib/validators/checkout'
import { CheckoutAccountError, placeCheckout } from '@/lib/checkout/place'
import { cartDateRefusal } from '@/lib/checkout/dates'
import { isBookingCodeBusy } from '@/lib/utils/bookingCode'
import { onboardingRefusal } from '@/lib/auth/contact'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { ok } from '@/lib/validators'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'
import { bookingFailure, bookingFailureJson } from '@/lib/booking/simulate'
import { displayStatusOf, statusSelect } from '@/lib/booking/lifecycle'
import { InvoiceError } from '@/lib/invoice/issue'
import { sendInvoiceNotification } from '@/lib/invoice/notifyInvoice'
import { billOf, billSelect } from '@/lib/invoice/bill'

export async function GET() {
  try {
    const session = await requireSession()
    const bookings = await prisma.booking.findMany({
      where: { userId: session.userId, status: { not: 'draft' } }, // draf = urusan admin, tak tampil ke jamaah
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, bookingCode: true, ...statusSelect,
        createdAt: true, ...billSelect,
        _count: { select: { pilgrims: true } },
      },
    })
    // `status` = status tampilan (menunggu bayar / diverifikasi / dikonfirmasi / …), bukan siklus hidup mentah; bukti yang menunggu tak dibocorkan terpisah.
    // `totalAmount` = TAGIHAN (subtotal + pajak ditambahkan, lib/invoice/bill.ts) — pajak dan subtotal tak dipisah di daftar.
    return NextResponse.json(ok(bookings.map(({ payments, confirmedAt, invoice, totalAmount, ...b }) => ({ ...b, totalAmount: billOf({ totalAmount, invoice }).grandTotal, status: displayStatusOf({ ...b, confirmedAt, payments }) }))))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return apiErrorJson('unauthorized', 401)
    }
    console.error('[bookings/GET]', error instanceof Error ? error.name : error)
    return apiErrorJson('internal', 500)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    // Checkout = jalur PELANGGAN (docs/arsitektur-booking-engine-v2.md §10.5); staf memesan untuk pelanggan lewat form booking admin (draf).
    if (session.role !== 'pilgrim') return apiErrorJson('staffUseAdminForm', 403)

    // Notifikasi pembayaran/pembaruan bergantung pada nomor ini — gerbang UI saja tidak cukup (docs/arsitektur-auth.md §3.5; SEC-107).
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
    const limit = await consume(policy('bookingCreateUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const parsed = checkoutCartSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return zodFailure(parsed.error)
    const pastDate = await cartDateRefusal(parsed.data)
    if (pastDate) return pastDate

    // Jatuh tempo = `defaultDueDays` dari Pengaturan Invoice (saran, tidak mengikat — D4); invoice terbit LANGSUNG bersama booking (keputusan pemilik K6-c).
    const { defaultDueDays } = await getInvoiceSettings()

    const booking = await placeCheckout(session.userId, parsed.data, defaultDueDays)

    // Konfirmasi pesanan = notifikasi invoice terbit berisi tautan invoice publik (Fase 6c, menggantikan `booking_submitted` supaya tak dobel).
    // Best-effort setelah transaksi commit; tidak pernah melempar dan tidak memblokir respons.
    void sendInvoiceNotification(booking.id, { dedupe: true })

    return NextResponse.json(ok({ bookingId: booking.id, bookingCode: booking.bookingCode }), { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    // Invoice tak dapat diterbitkan (setelan nomor/jatuh tempo bermasalah) — urusan admin; jamaah menerima pesan umum, rinciannya di log server.
    if (error instanceof InvoiceError) {
      console.error('[bookings/POST] invoice', error.message)
      return apiErrorJson('orderNotIssuable', 422)
    }
    if (error instanceof CheckoutAccountError) return apiErrorJson('accountCannotOrder', 409)
    if (isBookingCodeBusy(error)) return apiErrorJson('orderBusy', 409)
    try {
      // Aturan visa (422 + daftar pelanggaran), item tak dapat dijual / tak ditemukan (422), kuota habis / bentrok (409) — satu pemeta dengan pratinjau.
      return bookingFailureJson(bookingFailure(error))
    } catch {
      console.error('[bookings/POST]', error instanceof Error ? error.name : error)
      return apiErrorJson('internal', 500)
    }
  }
}
