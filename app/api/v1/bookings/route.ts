import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { createBookingSchema } from '@/lib/validators/booking'
import { generateBookingCode } from '@/lib/utils/bookingCode'
import { requireContactForBooking } from '@/lib/auth/contact'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { notify } from '@/lib/notifications/notify'
import { formatDeadline } from '@/lib/notifications/events'
import { ok, err } from '@/lib/validators'
import { computeSellPrice } from '@/lib/pricing/computeSellPrice'
import { computeCateringBookingPrice } from '@/lib/pricing/computeCateringPrice'
import { requireSellPrice } from '@/lib/pricing/engine/read'
import { computeTourPackageBreakdown, baseTotal, totalForVehicle, hotelChoicePrice } from '@/lib/pricing/computeTourPackagePrice'
import { reserveHotel, reserveTransport, reserveMuthowifPool, reserveHaji } from '@/lib/quota/adapters'
import { ItemNotBookableError } from '@/lib/booking/errors'

// Hari probe kalau jamaah tidak memilih durasi spesifik — sama alasan dengan
// DEFAULT_PROBE_DAY di lib/pricing/refreshVisaProductCache.ts (bukan hardcode angka bisnis).
const DEFAULT_DURATION_PROBE_DAY = 1

export async function GET() {
  try {
    const session = await requireSession()
    const bookings = await prisma.booking.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, bookingCode: true, status: true,
        departureDate: true, returnDate: true, totalAmount: true, createdAt: true,
        _count: { select: { pilgrims: true } },
      },
    })
    return NextResponse.json(ok(bookings))
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

    // Notifikasi pembayaran/pembaruan bergantung pada nomor ini — gerbang UI saja tidak cukup (docs/arsitektur-auth.md §3.5).
    if (!(await requireContactForBooking(session.userId, session.role))) {
      return NextResponse.json(err('Lengkapi nomor telepon dan WhatsApp Anda sebelum memesan.'), { status: 422 })
    }
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
    const paymentDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000)

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

    const booking = await prisma.$transaction(async (tx) => {
      // ── 1. Reserve quotas (throws if insufficient) — via lib/quota/adapters, docs/arsitektur-booking.md §6 Step 1 ──
      // Loop generik atas items[] (docs/arsitektur-booking.md §6 Step 5) — dispatch per itemType,
      // TypeScript memaksa exhaustiveness (switch tanpa default akan error compile kalau ada
      // itemType baru yang belum ditangani, sama semangatnya dengan quotaAdapters registry).
      let tourPackageIdx = 0
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
        }
      }

      // ── 2. Create booking (totalAmount diisi belakangan, setelah semua item dihitung) ──
      const bk = await tx.booking.create({
        data: {
          bookingCode,
          userId:          session.userId,
          status:          'awaiting_payment',
          departureDate:   new Date(data.departureDate),
          returnDate:      new Date(data.returnDate),
          season:          data.season,
          totalAmount:     0,
          paymentDeadline,
        },
      })

      // ── 3. Line items — harga dihitung SERVER-SIDE dari referensi yang dikirim (id jadwal/
      // kuota/paket), TIDAK PERNAH dari client — sama persis logic sebelum redesain items[],
      // cuma dispatch-nya sekarang satu loop generik. totalAmount diakumulasi dari sini,
      // menutup Gap #4 KRITIS (docs/arsitektur-umroh.md §7) — angka agregat tidak lagi
      // dipercaya dari client sama sekali.
      let totalAmount = 0
      tourPackageIdx = 0
      for (const item of data.items) {
        switch (item.itemType) {
          case 'hotel': {
            await tx.hotelRoomSchedule.findUniqueOrThrow({ where: { id: item.hotelRoomScheduleId }, select: { id: true } }) // 404 bila jadwal tak ada
            // Harga dari titik harga (docs/arsitektur-harga-terpadu.md §15); belum berharga → 422, tak pernah gratis.
            const pricePerNight = await requireSellPrice('hotel', item.hotelRoomScheduleId, 'kamar hotel', tx)
            const totalPrice = pricePerNight * item.nights * item.numRooms
            await tx.bookingHotel.create({
              data: {
                bookingId: bk.id, hotelRoomScheduleId: item.hotelRoomScheduleId,
                checkIn: new Date(item.checkIn), checkOut: new Date(item.checkOut),
                nights: item.nights, numRooms: item.numRooms, numGuests: data.totalPilgrims,
                pricePerNight, totalPrice,
              },
            })
            totalAmount += totalPrice
            break
          }
          case 'transport': {
            const quota = await tx.transportQuota.findUniqueOrThrow({ where: { id: item.transportQuotaId }, select: { pricingId: true } })
            const unitPrice = await requireSellPrice('transport', quota.pricingId, 'transport', tx)
            await tx.bookingTransport.create({
              data: {
                bookingId: bk.id, transportQuotaId: item.transportQuotaId,
                travelDate: new Date(data.departureDate),
                numPassengers: item.numPassengers,
                unitPrice, totalPrice: unitPrice,
                pickupDetail: item.pickupDetail ?? null,
                dropoffDetail: item.dropoffDetail ?? null,
              },
            })
            totalAmount += unitPrice
            break
          }
          case 'muthowif': {
            // muthowifId TIDAK diisi — admin assign belakangan (docs/arsitektur-muthowif.md §9).
            const servicePrice = await tx.muthowifServicePrice.findFirstOrThrow({ select: { id: true } })
            const pricePerDay = await requireSellPrice('muthowif', servicePrice.id, 'layanan muthowif', tx)
            const totalPrice = pricePerDay * item.numDays * item.numPeople
            await tx.bookingMuthowif.create({
              data: {
                bookingId: bk.id, muthowifId: null,
                startDate: new Date(item.startDate), endDate: new Date(item.endDate),
                numDays: item.numDays, numPeople: item.numPeople, totalPrice,
              },
            })
            totalAmount += totalPrice
            break
          }
          case 'catering': {
            // Harga dihitung server-side dari CateringOption (musim pada tanggal mulai) — `totalPrice` dari klien TIDAK dipakai
            // (dan tak ada lagi di skema). Opsi nonaktif / belum berharga → 422 (ItemNotBookableError).
            const { totalPrice } = await computeCateringBookingPrice({
              cateringOptionId: item.cateringOptionId, startDate: new Date(item.startDate), numDays: item.numDays, numPeople: item.numPeople,
            })
            await tx.bookingCatering.create({
              data: {
                bookingId: bk.id, cateringOptionId: item.cateringOptionId,
                startDate: new Date(item.startDate), endDate: new Date(item.endDate),
                numDays: item.numDays, numPeople: item.numPeople, totalPrice,
              },
            })
            totalAmount += totalPrice
            break
          }
          case 'tourPackage': {
            // Harga: baseTotal() (komponen + kendaraan/hotel mode 'included') + tambahan
            // kendaraan/hotel mode 'user_choice' KALAU pilgrim benar-benar memilihnya — tidak
            // pernah dari client (docs/arsitektur-ziarah.md §12.4).
            const { breakdown, transportQuotaId } = tourPackageResolved[tourPackageIdx++]!
            let totalPrice = baseTotal(breakdown)
            let tourDate: Date
            if (transportQuotaId) {
              const quota = await tx.transportQuota.findUniqueOrThrow({ where: { id: transportQuotaId } })
              tourDate = quota.travelDate
              if (breakdown.transportMode === 'user_choice') {
                totalPrice = totalForVehicle(breakdown, quota.pricingId) ?? totalPrice
              }
            } else {
              tourDate = new Date(data.departureDate)
            }
            if (breakdown.hotelMode === 'user_choice' && item.chosenHotelRoomScheduleId && item.chosenHotelNumRooms) {
              totalPrice += hotelChoicePrice(breakdown, item.chosenHotelRoomScheduleId, item.chosenHotelNumRooms) ?? 0
            }
            await tx.bookingTourPackage.create({
              data: {
                bookingId: bk.id, tourPackageId: item.tourPackageId, transportQuotaId,
                tourDate, numPeople: item.numPeople, totalPrice,
                chosenHotelRoomScheduleId: item.chosenHotelRoomScheduleId ?? null,
                chosenHotelNumRooms: item.chosenHotelNumRooms ?? null,
              },
            })
            totalAmount += totalPrice
            break
          }
          case 'haji': {
            const unitPrice = await requireSellPrice('haji', item.hajiProductId, 'produk haji', tx)
            const totalPrice = unitPrice * item.numPersons
            await tx.bookingHaji.create({
              data: { bookingId: bk.id, hajiProductId: item.hajiProductId, numPersons: item.numPersons, totalPrice },
            })
            totalAmount += totalPrice
            break
          }
        }
      }

      // ── 4. Pilgrims + Visa applications ───────────────────────────
      // visaProductId di-set di sini (menutup Gap #1 docs/arsitektur-visa.md §7), plus field
      // snapshot HPP/kurs/vendor (docs/arsitektur-harga.md §7) diisi dari computeSellPrice()
      // — sebelumnya field ini ada di schema tapi tidak pernah diisi kode manapun. Harga visa
      // juga diakumulasi ke totalAmount (sebelumnya tidak pernah masuk hitungan total sama
      // sekali, baik saat dipercaya dari client maupun sesudahnya).
      for (const p of data.pilgrims) {
        // docs/arsitektur-manifest.md §3 — fieldValues generik, bentuk & wajib-tidaknya field
        // sudah divalidasi di lib/validators/booking.ts superRefine (ManifestFieldRequirement).
        const pilgrim = await tx.bookingPilgrim.create({
          data: { bookingId: bk.id, fieldValues: p.fieldValues as Prisma.InputJsonValue },
        })

        // docs/arsitektur-booking.md §6 Step 6a — visaProductId opsional: pilgrim yang tidak
        // pilih visa (mis. checkout Transport-only) tidak dapat VisaApplication sama sekali dan
        // tidak menyumbang apa pun ke totalAmount — konsisten "tidak ada produk yang mewajibkan
        // produk lain saat checkout".
        if (p.visaProductId) {
          const visaProductId = p.visaProductId
          const visaProduct = await tx.visaProduct.findUnique({ where: { id: visaProductId } })
          const durationDays = p.selectedDurationDays ?? DEFAULT_DURATION_PROBE_DAY
          const priceResult = visaProduct
            ? await computeSellPrice('visa', visaProductId, durationDays)
            : null

          await tx.visaApplication.create({
            data: {
              bookingPilgrimId: pilgrim.id,
              visaProductId,
              visaType: visaProduct?.visaType ?? 'umroh', // fallback/display, lihat docs/arsitektur-visa.md §2
              status: 'pending_documents',
              selectedDurationDays: p.selectedDurationDays ?? null,
              hppSnapshotRupiah: priceResult ? priceResult.hppRupiah : null,
              sellPriceSnapshot: priceResult ? priceResult.sellPrice : null,
              exchangeRateIdsUsed: priceResult ? priceResult.rateUsed : [],
              vendorIdsUsed: priceResult ? priceResult.vendorUsed : [],
            },
          })

          if (priceResult) totalAmount += priceResult.sellPrice
        }
      }

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
