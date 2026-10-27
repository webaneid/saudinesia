import type { Prisma } from '@prisma/client'
import { ItemNotBookableError } from './errors'
import type { CreateBookingInput, BookingItemInput } from '@/lib/validators/booking'
import { computeCateringBookingPrice } from '@/lib/pricing/computeCateringPrice'
import type { TourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'
import {
  compositeLines, lineFromPoint, lineTotalSell, peekCost, sumSell, takePoint, takeVisaTier, writeSnapshots,
  type CompositePart, type PendingItem, type SnapshotLine,
} from '@/lib/pricing/engine/snapshot'

// Hari probe kalau jamaah tidak memilih durasi spesifik — sama alasan dengan DEFAULT_PROBE_DAY di lib/pricing/engine/owners/visa.ts (bukan hardcode angka bisnis).
const DEFAULT_DURATION_PROBE_DAY = 1

/** Paket ziarah yang sudah di-resolve SEBELUM transaksi (breakdown + kuota kendaraan), urut sesuai kemunculannya di `items`. */
export type TourPackageResolved = { breakdown: TourPackageBreakdown; transportQuotaId: string | null }

const day = (d: string | Date): string => {
  const iso = new Date(d).toISOString().slice(0, 10)
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
}

type Item<T extends BookingItemInput['itemType']> = Extract<BookingItemInput, { itemType: T }>

/**
 * SEMUA item booking (+ visa per jamaah) ditulis di sini: harga dibaca SEKALI dari titik harga (`engine/snapshot`), dipakai membentuk baris item DAN dibekukan ke
 * `price_snapshots`; total yang dikembalikan = Σ snapshot yang baru ditulis (invarian I4 docs/arsitektur-harga-terpadu.md §17). Tak ada angka harga dari klien.
 * Dipanggil di dalam transaksi booking; melempar `ItemNotBookableError` (422) untuk item yang belum/tak bisa dijual — transaksi (termasuk kuota yang sudah ditahan) dibatalkan.
 * Lem sementara menunggu perombakan booking engine: yang bertahan hanyalah kontrak `price_snapshots` + `engine/snapshot.ts`.
 */
export async function writeBookingItems(
  tx: Prisma.TransactionClient, bookingId: string, data: CreateBookingInput, tourResolved: readonly TourPackageResolved[],
): Promise<number> {
  const pending: PendingItem[] = []
  const add = (meta: PendingItem['meta'], lines: SnapshotLine[]) => pending.push({ meta, lines })
  let tourIdx = 0

  for (const item of data.items) {
    switch (item.itemType) {
      case 'hotel': {
        const sch = await tx.hotelRoomSchedule.findUniqueOrThrow({
          where: { id: item.hotelRoomScheduleId },
          select: { period: { select: { periodStart: true, periodEnd: true, hotel: { select: { name: true } } } }, roomType: { select: { name: true } } }, // 404 bila jadwal tak ada
        })
        // Tanggal menginap harus berada di periode harga jadwal yang dipilih (jadwal periode murah tak boleh dipakai untuk tanggal musim ramai).
        if (new Date(item.checkIn) < sch.period.periodStart || new Date(item.checkOut) > sch.period.periodEnd) {
          throw new ItemNotBookableError('Tanggal menginap di luar periode harga kamar yang dipilih')
        }
        const point = await takePoint(tx, 'hotel', item.hotelRoomScheduleId, '', 'kamar hotel')
        const label = `${sch.period.hotel.name} — ${sch.roomType.name}`
        const line = lineFromPoint(point, { description: label, qty: item.nights * item.numRooms, unit: 'room_night' })
        const row = await tx.bookingHotel.create({
          data: {
            bookingId, hotelRoomScheduleId: item.hotelRoomScheduleId,
            checkIn: new Date(item.checkIn), checkOut: new Date(item.checkOut),
            nights: item.nights, numRooms: item.numRooms, numGuests: data.totalPilgrims,
            pricePerNight: point.sellIdr, totalPrice: lineTotalSell(line),
          },
        })
        add({ itemType: 'hotel', itemId: row.id, label, detail: `${day(item.checkIn)} – ${day(item.checkOut)} · ${item.nights} malam · ${item.numRooms} kamar`, qty: item.numRooms }, [line])
        break
      }
      case 'transport': {
        const quota = await tx.transportQuota.findUniqueOrThrow({
          where: { id: item.transportQuotaId },
          select: { pricingId: true, travelDate: true, pricing: { select: { trip: { select: { name: true } }, vehicle: { select: { name: true } } } } },
        })
        const point = await takePoint(tx, 'transport', quota.pricingId, '', 'transport')
        const label = `${quota.pricing.trip.name} (${quota.pricing.vehicle.name})`
        const line = lineFromPoint(point, { description: label, qty: 1, unit: 'vehicle' })
        const row = await tx.bookingTransport.create({
          data: {
            bookingId, transportQuotaId: item.transportQuotaId,
            travelDate: quota.travelDate,
            numPassengers: item.numPassengers,
            unitPrice: point.sellIdr, totalPrice: lineTotalSell(line),
            pickupDetail: item.pickupDetail ?? null,
            dropoffDetail: item.dropoffDetail ?? null,
          },
        })
        add({ itemType: 'transport', itemId: row.id, label, detail: `${day(quota.travelDate)} · ${item.numPassengers} penumpang`, qty: item.numPassengers }, [line])
        break
      }
      case 'muthowif': {
        // muthowifId TIDAK diisi — admin assign belakangan (docs/arsitektur-muthowif.md §9).
        const service = await tx.muthowifServicePrice.findFirstOrThrow({ select: { id: true } })
        const point = await takePoint(tx, 'muthowif', service.id, '', 'layanan muthowif')
        const line = lineFromPoint(point, { description: 'Layanan Muthowif', qty: item.numDays * item.numPeople, unit: 'person_day' })
        const row = await tx.bookingMuthowif.create({
          data: {
            bookingId, muthowifId: null,
            startDate: new Date(item.startDate), endDate: new Date(item.endDate),
            numDays: item.numDays, numPeople: item.numPeople, totalPrice: lineTotalSell(line),
          },
        })
        add({ itemType: 'muthowif', itemId: row.id, label: 'Layanan Muthowif', detail: `${day(item.startDate)} – ${day(item.endDate)} · ${item.numDays} hari · ${item.numPeople} orang`, qty: item.numPeople }, [line])
        break
      }
      case 'catering': {
        // Harga dihitung server-side dari titik harga musim pada tanggal mulai; opsi nonaktif / belum berharga → 422.
        const { point } = await computeCateringBookingPrice({
          cateringOptionId: item.cateringOptionId, startDate: new Date(item.startDate), numDays: item.numDays, numPeople: item.numPeople,
        }, tx)
        const option = await tx.cateringOption.findUniqueOrThrow({ where: { id: item.cateringOptionId }, select: { name: true } })
        const line = lineFromPoint(point, { description: option.name, qty: item.numDays * item.numPeople, unit: 'person_day' })
        const row = await tx.bookingCatering.create({
          data: {
            bookingId, cateringOptionId: item.cateringOptionId,
            startDate: new Date(item.startDate), endDate: new Date(item.endDate),
            numDays: item.numDays, numPeople: item.numPeople, totalPrice: lineTotalSell(line),
          },
        })
        add({ itemType: 'catering', itemId: row.id, label: option.name, detail: `${day(item.startDate)} – ${day(item.endDate)} · ${item.numDays} hari · ${item.numPeople} orang`, qty: item.numPeople }, [line])
        break
      }
      case 'tourPackage': {
        const { breakdown, transportQuotaId } = tourResolved[tourIdx++]!
        const tour = await tx.tourPackage.findUniqueOrThrow({ where: { id: item.tourPackageId }, select: { name: true } })
        const lines = await tourPackageLines(tx, item, tour.name, breakdown, transportQuotaId)
        const totalPrice = sumSell(lines)
        if (!(totalPrice > 0)) throw new ItemNotBookableError('Harga paket ziarah belum ditetapkan')
        let tourDate: Date
        if (transportQuotaId) {
          tourDate = (await tx.transportQuota.findUniqueOrThrow({ where: { id: transportQuotaId }, select: { travelDate: true } })).travelDate
        } else {
          tourDate = new Date(data.departureDate)
        }
        const row = await tx.bookingTourPackage.create({
          data: {
            bookingId, tourPackageId: item.tourPackageId, transportQuotaId,
            tourDate, numPeople: item.numPeople, totalPrice,
            // hanya bermakna (dan hanya menahan kuota) pada mode user_choice — selain itu null, supaya release/confirm kuota tak menyentuh kuota yang tak pernah ditahan
            chosenHotelRoomScheduleId: breakdown.hotelMode === 'user_choice' ? item.chosenHotelRoomScheduleId ?? null : null,
            chosenHotelNumRooms: breakdown.hotelMode === 'user_choice' ? item.chosenHotelNumRooms ?? null : null,
          },
        })
        add({ itemType: 'tourPackage', itemId: row.id, label: tour.name, detail: `${day(tourDate)} · ${item.numPeople} orang`, qty: item.numPeople }, lines)
        break
      }
      case 'haji': {
        const haji = await tx.hajiProduct.findUniqueOrThrow({ where: { id: item.hajiProductId }, select: { name: true } })
        const lines = await compositeLines(tx, { ownerType: 'haji', ownerId: item.hajiProductId, what: 'produk haji', label: haji.name, multiplier: item.numPersons })
        const totalPrice = sumSell(lines)
        if (!(totalPrice > 0)) throw new ItemNotBookableError('Harga produk haji belum ditetapkan')
        const row = await tx.bookingHaji.create({
          data: { bookingId, hajiProductId: item.hajiProductId, numPersons: item.numPersons, totalPrice },
        })
        add({ itemType: 'haji', itemId: row.id, label: haji.name, detail: `${item.numPersons} orang`, qty: item.numPersons }, lines)
        break
      }
    }
  }

  // ── Pilgrims + Visa applications ───────────────────────────────────────────────────────────────────────────────────
  // visaProductId opsional per jamaah (docs/arsitektur-booking.md §6 Step 6a): tanpa visa = tanpa VisaApplication dan tanpa sumbangan harga. Harga visa = tier
  // titik harga yang memuat lama tinggal (harga manual menang); modal/jejak kurs-vendor beku ada di `price_snapshots`.
  for (const p of data.pilgrims) {
    const pilgrim = await tx.bookingPilgrim.create({ data: { bookingId, fieldValues: p.fieldValues as Prisma.InputJsonValue } })
    if (!p.visaProductId) continue

    const visaProduct = await tx.visaProduct.findUnique({ where: { id: p.visaProductId }, select: { name: true, visaType: true } })
    if (!visaProduct) throw new ItemNotBookableError('Produk visa tidak tersedia')
    const point = await takeVisaTier(tx, p.visaProductId, p.selectedDurationDays ?? DEFAULT_DURATION_PROBE_DAY, 'visa')
    const label = /visa/i.test(visaProduct.name) ? visaProduct.name : `Visa ${visaProduct.name}`
    const line = lineFromPoint(point, { description: label, qty: 1, unit: 'person' })
    const application = await tx.visaApplication.create({
      data: {
        bookingPilgrimId: pilgrim.id,
        visaProductId: p.visaProductId,
        visaType: visaProduct.visaType, // fallback/display, lihat docs/arsitektur-visa.md §2
        status: 'pending_documents',
        selectedDurationDays: p.selectedDurationDays ?? null,
      },
    })
    add({ itemType: 'visa', itemId: application.id, label, detail: p.selectedDurationDays ? `${p.selectedDurationDays} hari` : '', qty: 1 }, [line])
  }

  return writeSnapshots(tx, bookingId, pending)
}

/**
 * Baris satu paket ziarah: harga dasar = titik harga paket (komponen + bagian `included` + penyesuaian), ditambah pilihan pilgrim (mode `user_choice`) yang
 * harganya dibaca dari titik harga sub-modul. Pilihan di luar daftar opsi paket ditolak (dulu diam-diam bernilai 0 padahal kuotanya ikut tertahan).
 */
async function tourPackageLines(
  tx: Prisma.TransactionClient, item: Item<'tourPackage'>, name: string, breakdown: TourPackageBreakdown, transportQuotaId: string | null,
): Promise<SnapshotLine[]> {
  const parts: CompositePart[] = []
  if (breakdown.transportMode === 'included' && breakdown.includedTransportPricingId && (breakdown.includedTransportPrice ?? 0) > 0) {
    const pricingId = breakdown.includedTransportPricingId
    parts.push({
      lineKey: 'kendaraan-termasuk', description: `Kendaraan: ${breakdown.includedVehicleName ?? 'termasuk paket'}`, qty: 1, unit: 'vehicle',
      unitSellIdr: breakdown.includedTransportPrice!, unitCostIdr: await peekCost(tx, 'transport', pricingId),
      ref: { ownerType: 'transport', ownerId: pricingId, variantKey: '' },
    })
  }
  if (breakdown.hotelMode === 'included') {
    for (const h of breakdown.hotels) {
      parts.push({
        lineKey: `hotel-termasuk:${h.id}`, description: `Hotel: ${h.hotelName} — ${h.roomTypeName}`, qty: h.nights * h.numRooms, unit: 'room_night',
        unitSellIdr: h.pricePerNight, unitCostIdr: await peekCost(tx, 'hotel', h.hotelRoomScheduleId),
        ref: { ownerType: 'hotel', ownerId: h.hotelRoomScheduleId, variantKey: '' },
      })
    }
  }
  const lines = await compositeLines(tx, { ownerType: 'tour_package', ownerId: item.tourPackageId, what: 'paket ziarah', label: name, multiplier: 1, parts })

  if (breakdown.transportMode === 'user_choice' && transportQuotaId) {
    const quota = await tx.transportQuota.findUniqueOrThrow({ where: { id: transportQuotaId }, select: { pricingId: true } })
    const option = breakdown.vehicleOptions.find(v => v.transportPricingId === quota.pricingId)
    if (!option) throw new ItemNotBookableError('Kendaraan yang dipilih tidak tersedia untuk paket ini')
    const point = await takePoint(tx, 'transport', quota.pricingId, '', 'kendaraan pilihan')
    lines.push(lineFromPoint(point, { lineKey: 'kendaraan-pilihan', description: `Kendaraan pilihan: ${option.vehicleName}`, qty: 1, unit: 'vehicle' }))
  }
  if (breakdown.hotelMode === 'user_choice' && item.chosenHotelRoomScheduleId && item.chosenHotelNumRooms) {
    const option = breakdown.hotelOptions.find(o => o.hotelRoomScheduleId === item.chosenHotelRoomScheduleId)
    if (!option) throw new ItemNotBookableError('Hotel yang dipilih tidak tersedia untuk paket ini')
    const point = await takePoint(tx, 'hotel', item.chosenHotelRoomScheduleId, '', 'hotel pilihan')
    lines.push(lineFromPoint(point, {
      lineKey: 'hotel-pilihan', description: `Hotel pilihan: ${option.hotelName} — ${option.roomTypeName}`, qty: option.nights * item.chosenHotelNumRooms, unit: 'room_night',
    }))
  }
  return lines
}
