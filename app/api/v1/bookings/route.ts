import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { requireSession } from '@/lib/auth/session'
import { createBookingSchema } from '@/lib/validators/booking'
import { withBookingCode } from '@/lib/utils/bookingCode'
import { onboardingRefusal } from '@/lib/auth/contact'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { notify } from '@/lib/notifications/notify'
import { formatDeadline } from '@/lib/notifications/events'
import { ok, err } from '@/lib/validators'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { prepareBooking, writeBooking, RuleViolationError } from '@/lib/booking/create'
import { displayStatusOf, statusSelect } from '@/lib/booking/lifecycle'
import { InvoiceError, issueInvoice } from '@/lib/invoice/issue'
import { isSerializationConflict, retrySerializable } from '@/lib/booking/serializable'
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
    // Jatuh tempo = `defaultDueDays` dari Pengaturan Invoice (saran, tidak mengikat — D4); invoice terbit LANGSUNG bersama booking (keputusan pemilik K6-c).
    const { defaultDueDays } = await getInvoiceSettings()

    // Resolusi + aturan visa di luar transaksi, lalu kuota + item + snapshot di dalam — mesin yang SAMA dengan penerbitan draf admin (lib/booking/create.ts).
    const prepared = await prepareBooking({ items: data.items, pilgrims: data.pilgrims, departureDate: data.departureDate, totalPilgrims: data.totalPilgrims }, session.userId)
    const booking = await withBookingCode(bookingCode => retrySerializable(() => prisma.$transaction(async (tx) => {
      const bk = await tx.booking.create({
        data: {
          bookingCode,
          userId:          session.userId,
          status:          'active',
          departureDate:   new Date(data.departureDate),
          returnDate:      new Date(data.returnDate),
          season:          data.season,
          totalAmount:     0,
        },
      })
      await writeBooking(tx, prepared, bk.id)
      await issueInvoice(tx, bk.id, { dueDays: defaultDueDays, byUserId: null })
      return tx.booking.findUniqueOrThrow({ where: { id: bk.id }, select: { id: true, bookingCode: true, paymentDeadline: true } })
    }, { isolationLevel: 'Serializable' })))

    // Konfirmasi pesanan (WhatsApp + email) — sebelumnya template WA `bookingSubmitted` ada tapi tidak pernah dipanggil.
    // Best-effort setelah transaksi commit; notify() tidak pernah melempar dan tidak memblokir respons.
    void notify({
      userId: session.userId,
      bookingId: booking.id,
      event: { type: 'booking_submitted', code: booking.bookingCode, deadline: formatDeadline(booking.paymentDeadline!) },
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
      // Invoice tak dapat diterbitkan (setelan nomor/jatuh tempo bermasalah) — urusan admin; jamaah menerima pesan umum, rinciannya di log server.
      if (error instanceof InvoiceError) return NextResponse.json(err('Pesanan belum dapat diterbitkan — silakan hubungi admin'), { status: 422 })
      // Quota errors thrown by reserve helpers
      if (error.message.includes('insufficient') || error.message.includes('capacity')) {
        return NextResponse.json(err(error.message), { status: 409 })
      }
    }
    // Id produk/jadwal yang tidak ada → masukan salah, bukan galat server (SEC-130); bentrok serialisasi yang tersisa setelah diulang → coba lagi (SEC-83/113).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json(err('Produk yang dipilih tidak ditemukan lagi'), { status: 422 })
    if (isSerializationConflict(error)) return NextResponse.json(err('Kuota sedang diperebutkan — coba lagi'), { status: 409 })
    console.error('[bookings/POST]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
