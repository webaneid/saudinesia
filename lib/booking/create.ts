import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { BookingItemInput } from '@/lib/validators/booking'
import { computeTourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'
import { reserveFlightQuota } from '@/lib/quota'
import { reserveHotel, reserveTransport, reserveMuthowifPool, reserveHaji } from '@/lib/quota/adapters'
import { writeBookingItems, type TourPackageResolved } from './lineItems'
import type { ItemMeta } from '@/lib/pricing/engine/snapshot'
import { resolvePackageItem, type PackageResolved } from './packageItem'
import { visaRuleViolations } from './ruleContext'
import { blockingViolations, type RuleViolation } from './rules'
import { recomputeBookingDates } from './dates'
import { ItemNotBookableError, tagItem } from './errors'

// SATU mesin pesan (docs/arsitektur-booking-engine-v2.md §10.3): jalur jamaah `POST /bookings` dan penerbitan draf admin memakai fungsi yang SAMA —
// resolusi paket → aturan visa → tahan kuota → item + snapshot harga → tanggal acuan → total. Pratinjau = `writeBooking` di transaksi yang di-rollback.

/** Masukan pesan. Jalur jamaah membawa `departureDate` booking (dipakai Paket Ziarah tanpa `tourDate`); draf admin tidak (tanggal menempel di item, D1). */
export type BookingInput = {
  items: BookingItemInput[]
  /** `pilgrimId` = jamaah yang SUDAH ada (revisi: ganti visa) — tak dibuat ulang, hanya visanya yang ditulis. */
  pilgrims: Array<{ fieldValues?: Record<string, unknown>; visaProductId?: string; selectedDurationDays?: number; pilgrimId?: string }>
  departureDate?: string
  totalPilgrims?: number
  /** Rencana tanggal berangkat visa bila item yang ditulis tak memuat tiket (revisi: tiket sudah ada di booking). */
  plannedTravelDate?: string
}

export type PreparedBooking = {
  data: BookingInput
  tours: TourPackageResolved[]
  packages: PackageResolved[]
  /** Pelanggaran aturan yang DILONGGARKAN untuk pelanggan ini (peringatan, tidak menghalangi). */
  warnings: RuleViolation[]
}

export class RuleViolationError extends Error {
  constructor(public readonly violations: RuleViolation[]) { super(violations[0]?.message ?? 'Aturan produk tidak terpenuhi') }
}

/**
 * Resolusi di LUAR transaksi (bacaan saja): kendaraan Paket Ziarah, isi Paket Umroh, aturan visa untuk pemilik booking.
 * Melempar `RuleViolationError` (aturan tak dilonggarkan) atau `ItemNotBookableError` (item tak dapat dijual).
 */
export async function prepareBooking(data: BookingInput, ownerId: string, opts: { rules?: boolean } = {}): Promise<PreparedBooking> {
  // Kendaraan Paket Ziarah: mode included → kuota kendaraan dicari dari tanggal tur; user_choice → kuota yang dikirim (docs/arsitektur-ziarah.md §12.6).
  const tours = await Promise.all(data.items.flatMap((i, index) => (i.itemType === 'tourPackage' ? [{ tp: i, index }] : [])).map(async ({ tp, index }) => { try {
    const breakdown = await computeTourPackageBreakdown(tp.tourPackageId)
    let transportQuotaId: string | null = null
    if (breakdown.transportMode === 'included' && breakdown.includedTransportPricingId) {
      const date = tp.tourDate ?? data.departureDate
      if (!date) throw new ItemNotBookableError('Tanggal paket ziarah wajib diisi')
      const quota = await prisma.transportQuota.findUnique({
        where: { pricingId_travelDate: { pricingId: breakdown.includedTransportPricingId, travelDate: new Date(date) } },
      })
      if (!quota) throw new ItemNotBookableError('Kendaraan untuk paket ini belum tersedia di tanggal keberangkatan — hubungi admin.')
      transportQuotaId = quota.id
    } else if (breakdown.transportMode === 'user_choice' && tp.transportQuotaId) {
      transportQuotaId = tp.transportQuotaId
    }
    return { breakdown, transportQuotaId }
  } catch (e) { return tagItem(e, index) } }))
  const packages = await Promise.all(data.items.flatMap((i, index) => (i.itemType === 'package' ? [resolvePackageItem(i).catch(e => tagItem(e, index))] : [])))
  // Revisi menulis SUBSET item; aturan visa dievaluasi atas isi booking LENGKAP lewat pemanggilan terpisah (rules: true) — bukan atas subset.
  if (opts.rules === false) return { data, tours, packages, warnings: [] }
  const violations = await visaRuleViolations(data, ownerId, packages, tours)
  const blocking = blockingViolations(violations)
  if (blocking.length > 0) throw new RuleViolationError(blocking)
  return { data, tours, packages, warnings: violations.filter(v => v.severity === 'warning') }
}

/**
 * Di DALAM transaksi: tahan kuota (melempar "insufficient" → 409), tulis item + jamaah + snapshot ke booking `bookingId` (baris sudah ada), hitung tanggal acuan,
 * simpan total = Σ snapshot (invarian I4). Mengembalikan total.
 */
export async function writeBooking(tx: Prisma.TransactionClient, p: PreparedBooking, bookingId: string, written?: ItemMeta[]): Promise<number> {
  await reserveItems(tx, p)
  const total = await writeBookingItems(tx, bookingId, p.data, p.tours, p.packages, written)
  await recomputeBookingDates(tx, bookingId)
  await tx.booking.update({ where: { id: bookingId }, data: { totalAmount: total } })
  return total
}

/** Tahan kuota setiap item masukan (melempar "insufficient" → 409). Dipakai pesan baru dan revisi (item yang ditambah). */
export async function reserveItems(tx: Prisma.TransactionClient, p: PreparedBooking): Promise<void> {
  let tourIdx = 0
  let packageIdx = 0
  for (const [itemIndex, item] of p.data.items.entries()) {
    try {
      switch (item.itemType) {
        case 'hotel':
          await reserveHotel(tx, item.hotelRoomScheduleId, item.numRooms)
          break
        case 'transport':
          await reserveTransport(tx, item.transportQuotaId, item.numPassengers)
          break
        case 'muthowif':
          // Kapasitas dicek sebagai POOL — muthowif spesifik ditentukan admin belakangan (docs/arsitektur-muthowif.md §9.2).
          await reserveMuthowifPool(tx, new Date(item.startDate), new Date(item.endDate), item.numPeople)
          break
        case 'catering':
          break // tidak berkapasitas
        case 'tourPackage': {
          // Kendaraan paket ziarah memakai TransportQuota yang SAMA dengan transport biasa (docs/arsitektur-ziarah.md §8.1, §12.6); hotel pilihan menahan kuota nyata.
          const r = p.tours[tourIdx++]!
          if (r.transportQuotaId) await reserveTransport(tx, r.transportQuotaId, item.numPeople)
          if (r.breakdown.hotelMode === 'user_choice' && item.chosenHotelRoomScheduleId && item.chosenHotelNumRooms) {
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
          const r = p.packages[packageIdx++]!
          if (r.flightScheduleId) await reserveFlightQuota(tx, r.flightScheduleId, item.numPeople) // hanya kursi tiket yang ditahan untuk paket (§10.2)
          break
        }
      }
    } catch (e) {
      tagItem(e, itemIndex) // editor baris menunjuk baris yang kuotanya kurang
    }
  }
}
