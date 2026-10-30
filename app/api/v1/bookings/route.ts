import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { requireSession } from '@/lib/auth/session'
import { createBookingSchema } from '@/lib/validators/booking'
import { generateBookingCode } from '@/lib/utils/bookingCode'
import { onboardingRefusal } from '@/lib/auth/contact'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { notify } from '@/lib/notifications/notify'
import { formatDeadline } from '@/lib/notifications/events'
import { ok, err } from '@/lib/validators'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { prepareBooking, writeBooking, RuleViolationError } from '@/lib/booking/create'
import { displayStatusOf, paymentDeadlineFor, statusSelect } from '@/lib/booking/lifecycle'

export async function GET() {
  try {
    const session = await requireSession()
    const bookings = await prisma.booking.findMany({
      where: { userId: session.userId, status: { not: 'draft' } }, // draf = urusan admin, tak tampil ke jamaah
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, bookingCode: true, ...statusSelect,
        totalAmount: true, createdAt: true,
        _count: { select: { pilgrims: true } },
      },
    })
    // `status` = status tampilan (menunggu bayar / diverifikasi / dikonfirmasi / …), bukan siklus hidup mentah; bukti yang menunggu tak dibocorkan terpisah.
    return NextResponse.json(ok(bookings.map(({ payments, confirmedAt, ...b }) => ({ ...b, status: displayStatusOf({ ...b, confirmedAt, payments }) }))))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[bookings/GET]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession()

    // Notifikasi pembayaran/pembaruan bergantung pada nomor ini — gerbang UI saja tidak cukup (docs/arsitektur-auth.md §3.5; SEC-107).
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
    const limit = await consume(policy('bookingCreateUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const body = await request.json().catch(() => null)
    const parsed = await createBookingSchema.safeParseAsync(body)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? 'Data tidak valid'
      return NextResponse.json(err(msg), { status: 400 })
    }

    const data = parsed.data
    const bookingCode = await generateBookingCode()
    // Batas bayar = akhir hari jatuh tempo (zona aplikasi), `defaultDueDays` dari Pengaturan Invoice. Hanya label untuk jamaah — tidak mengikat (docs/arsitektur-booking-engine-v2.md D4).
    const { defaultDueDays } = await getInvoiceSettings()
    const paymentDeadline = paymentDeadlineFor(new Date(), defaultDueDays)

    // Resolusi + aturan visa di luar transaksi, lalu kuota + item + snapshot di dalam — mesin yang SAMA dengan penerbitan draf admin (lib/booking/create.ts).
    const prepared = await prepareBooking({ items: data.items, pilgrims: data.pilgrims, departureDate: data.departureDate, totalPilgrims: data.totalPilgrims }, session.userId)
    const booking = await prisma.$transaction(async (tx) => {
      const bk = await tx.booking.create({
        data: {
          bookingCode,
          userId:          session.userId,
          status:          'active',
          departureDate:   new Date(data.departureDate),
          returnDate:      new Date(data.returnDate),
          season:          data.season,
          totalAmount:     0,
          paymentDeadline,
        },
      })
      await writeBooking(tx, prepared, bk.id)
      return tx.booking.findUniqueOrThrow({ where: { id: bk.id }, select: { id: true, bookingCode: true } })
    }, { isolationLevel: 'Serializable' })

    // Konfirmasi pesanan (WhatsApp + email) — sebelumnya template WA `bookingSubmitted` ada tapi tidak pernah dipanggil.
    // Best-effort setelah transaksi commit; notify() tidak pernah melempar dan tidak memblokir respons.
    void notify({
      userId: session.userId,
      bookingId: booking.id,
      event: { type: 'booking_submitted', code: booking.bookingCode, deadline: formatDeadline(paymentDeadline) },
      dedupe: true,
    })

    return NextResponse.json(ok({ bookingId: booking.id, bookingCode: booking.bookingCode }), { status: 201 })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
      // Aturan visa per produk (lib/booking/rules.ts): daftar apa yang kurang, untuk ditampilkan
      if (error instanceof RuleViolationError) return NextResponse.json({ success: false, error: error.message, meta: { violations: error.violations } }, { status: 422 })
      // Item yang belum/tidak bisa dijual (produk nonaktif, belum berharga) — bukan kuota habis (SEC-66)
      if (error instanceof ItemNotBookableError) return NextResponse.json(err(error.message), { status: 422 })
      // Quota errors thrown by reserve helpers
      if (error.message.includes('insufficient') || error.message.includes('capacity')) {
        return NextResponse.json(err(error.message), { status: 409 })
      }
    }
    console.error('[bookings/POST]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
