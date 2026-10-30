import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { recomputeBookingDates } from '@/lib/booking/dates'
import { requireSession } from '@/lib/auth/session'
import { createBookingSchema } from '@/lib/validators/booking'
import { generateBookingCode } from '@/lib/utils/bookingCode'
import { onboardingRefusal } from '@/lib/auth/contact'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { notify } from '@/lib/notifications/notify'
import { formatDeadline } from '@/lib/notifications/events'
import { ok, err } from '@/lib/validators'
import { computeTourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'
import { writeBookingItems } from '@/lib/booking/lineItems'
import { reserveHotel, reserveTransport, reserveMuthowifPool, reserveHaji } from '@/lib/quota/adapters'
import { reserveFlightQuota } from '@/lib/quota'
import { resolvePackageItem } from '@/lib/booking/packageItem'
import { visaRuleViolations } from '@/lib/booking/ruleContext'
import { blockingViolations } from '@/lib/booking/rules'
import { ItemNotBookableError } from '@/lib/booking/errors'
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

    // Resolve breakdown + transportQuotaId SEKALI per paket ziarah (dipakai reserve DAN create,
    // hindari query dobel + jaga konsistensi). Mode included: auto-resolve TransportQuota dari
    // includedTransportPricingId + departureDate (pilgrim tidak pilih kendaraan). Mode
    // user_choice: pakai transportQuotaId yang dikirim client (docs/arsitektur-ziarah.md §12.6).
    const tourPackageItems = data.items.filter(i => i.itemType === 'tourPackage')
    const tourPackageResolved = await Promise.all(tourPackageItems.map(async (tp) => {
      const breakdown = await computeTourPackageBreakdown(tp.tourPackageId)
      let transportQuotaId: string | null = null
      if (breakdown.transportMode === 'included' && breakdown.includedTransportPricingId) {
        const quota = await prisma.transportQuota.findUnique({
          where: { pricingId_travelDate: { pricingId: breakdown.includedTransportPricingId, travelDate: new Date(data.departureDate) } },
        })
        if (!quota) throw new Error('Kendaraan untuk paket ini belum tersedia di tanggal keberangkatan — hubungi admin.')
        transportQuotaId = quota.id
      } else if (breakdown.transportMode === 'user_choice' && tp.transportQuotaId) {
        transportQuotaId = tp.transportQuotaId
      }
      return { breakdown, transportQuotaId }
    }))
    // Paket Umroh: pilihan, tanggal (periode tiket), dan isi paket di-resolve SEKALI sebelum transaksi (lib/booking/packageItem.ts, §10.2).
    const packageResolved = await Promise.all(data.items.flatMap(i => (i.itemType === 'package' ? [resolvePackageItem(i)] : [])))

    // Aturan visa per produk (lib/booking/rules.ts): pelanggaran yang tak dilonggarkan untuk pemesan → 422 dengan daftar apa yang kurang.
    const violations = blockingViolations(await visaRuleViolations(data, session.userId, packageResolved, tourPackageResolved))
    if (violations.length > 0) {
      return NextResponse.json({ success: false, error: violations[0]!.message, meta: { violations } }, { status: 422 })
    }

    const booking = await prisma.$transaction(async (tx) => {
      // ── 1. Reserve quotas (throws if insufficient) — via lib/quota/adapters, docs/arsitektur-booking.md §6 Step 1 ──
      // Loop generik atas items[] (docs/arsitektur-booking.md §6 Step 5) — dispatch per itemType,
      // TypeScript memaksa exhaustiveness (switch tanpa default akan error compile kalau ada
      // itemType baru yang belum ditangani, sama semangatnya dengan quotaAdapters registry).
      let tourPackageIdx = 0
      let packageIdx = 0
      for (const item of data.items) {
        switch (item.itemType) {
          case 'hotel':
            await reserveHotel(tx, item.hotelRoomScheduleId, item.numRooms)
            break
          case 'transport':
            await reserveTransport(tx, item.transportQuotaId, item.numPassengers)
            break
          case 'muthowif':
            // Kapasitas dicek sebagai POOL (gabungan semua muthowif aktif) — muthowif spesifik
            // belum ditentukan saat booking, admin assign belakangan (docs/arsitektur-muthowif.md §9.2).
            await reserveMuthowifPool(tx, new Date(item.startDate), new Date(item.endDate), item.numPeople)
            break
          case 'catering':
            break // tidak berkapasitas, no-op sengaja (docs/arsitektur-booking.md §7 keputusan #6)
          case 'tourPackage': {
            // Paket ziarah reuse TransportQuota yang SAMA dengan booking Transport biasa — satu
            // unit kendaraan fisik tidak boleh dijual dobel lewat 2 jalur (docs/arsitektur-ziarah.md
            // §8.1, §12.6). Berlaku utk mode included (auto-resolve) MAUPUN user_choice.
            const resolved = tourPackageResolved[tourPackageIdx++]!
            if (resolved.transportQuotaId) await reserveTransport(tx, resolved.transportQuotaId, item.numPeople)
            // Hotel user_choice — BEDA dari hotel included (§10.7, statis di template, sengaja
            // tidak reservasi): di sini pilgrim memilih di waktu booking sebenarnya, jadi kuota
            // hotel nyata HARUS direservasi (§12.6).
            if (resolved.breakdown.hotelMode === 'user_choice' && item.chosenHotelRoomScheduleId && item.chosenHotelNumRooms) {
              await reserveHotel(tx, item.chosenHotelRoomScheduleId, item.chosenHotelNumRooms)
            }
            break
          }
          case 'haji':
            await reserveHaji(tx, item.hajiProductId, item.numPersons)
            break
          case 'flight':
            await reserveFlightQuota(tx, item.flightScheduleId, item.numPassengers)
            break
          case 'package': {
            const r = packageResolved[packageIdx++]!
            if (r.flightScheduleId) await reserveFlightQuota(tx, r.flightScheduleId, item.numPeople) // hanya kursi tiket yang ditahan untuk paket (§10.2)
            break
          }
        }
      }

      // ── 2. Create booking (totalAmount diisi belakangan, setelah semua item dihitung) ──
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

      // ── 3. Item + visa per jamaah + SNAPSHOT HARGA (lib/booking/lineItems.ts). Harga dibaca server dari titik harga, dibekukan ke price_snapshots, dan
      // `totalAmount` = Σ snapshot yang baru ditulis (invarian I4, docs/arsitektur-harga-terpadu.md §17) — tak ada angka harga dari klien, tak ada penjumlahan terpisah.
      const totalAmount = await writeBookingItems(tx, bk.id, data, tourPackageResolved, packageResolved)
      await recomputeBookingDates(tx, bk.id) // tanggal acuan = item paling awal / paling akhir (lib/booking/dates.ts)

      return tx.booking.update({ where: { id: bk.id }, data: { totalAmount } })
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
