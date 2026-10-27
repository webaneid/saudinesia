import { prisma } from '@/lib/db'
import { computeCostComponents, type ComponentBreakdown } from './costComponents'
import { sellPrices } from './engine/read'

export type { ComponentBreakdown }

// Kendaraan sbg OPSI (mode user_choice) — pilgrim pilih sendiri saat booking, harga TIDAK masuk
// ke base total (docs/arsitektur-ziarah.md §12.2/§12.4).
export type VehicleOption = {
  transportPricingId: string
  vehicleName: string
  vehiclePrice: number // TransportPricing.price — sudah final, pass-through, TIDAK dimargin lagi
}

// Hotel sbg komponen included (mode included) — pricePerNight di-snapshot dari
// HotelRoomSchedule.price saat baris dibuat (pass-through, tidak dimargin lagi), tapi setelah itu
// cuma REFERENSI/default — admin bisa edit lagi kapan saja, breakdown selalu pakai nilai
// tersimpan ini, bukan live dari HotelRoomSchedule (docs/arsitektur-ziarah.md §10.10).
export type HotelBreakdown = {
  id: string
  hotelName: string
  roomTypeName: string
  nights: number
  numRooms: number
  pricePerNight: number
  totalPrice: number
}

// Hotel sbg OPSI (mode user_choice) — pilgrim pilih tipe kamar + jumlah kamar saat booking,
// harga live (pass-through) dari HotelRoomSchedule.price, TIDAK masuk ke base total
// (docs/arsitektur-ziarah.md §12.3/§12.4).
export type HotelOption = {
  hotelRoomScheduleId: string
  hotelName: string
  roomTypeName: string
  nights: number
  pricePerNight: number // live dari HotelRoomSchedule.price saat breakdown dihitung
}

export type TourPackageBreakdown = {
  components: ComponentBreakdown[]
  componentsTotalSellPrice: number

  transportMode: 'included' | 'user_choice' | 'none'
  // included — 1 kendaraan dikunci, harga tersimpan/editable, MASUK base total. pricingId dipakai
  // untuk auto-resolve TransportQuota saat booking (docs/arsitektur-ziarah.md §12.6).
  includedTransportPricingId: string | null
  includedTransportPrice: number | null
  includedVehicleName: string | null
  // user_choice — daftar opsi, harga TIDAK masuk base total, dipakai wizard+booking.
  vehicleOptions: VehicleOption[]

  hotelMode: 'included' | 'user_choice' | 'none'
  // included — daftar baris dikunci, harga tersimpan/editable, MASUK base total.
  hotels: HotelBreakdown[]
  hotelsTotalPrice: number
  // user_choice — daftar opsi, harga TIDAK masuk base total, dipakai wizard+booking.
  hotelOptions: HotelOption[]
}

/**
 * Beda dari computeSellPrice() (Visa/Flight/Hotel/Transport/Muthowif — jumlah HPP semua
 * komponen dulu, baru SATU margin di akhir): Paket Ziarah butuh margin PER KOMPONEN, baru
 * dijumlah. Kendaraan/hotel yang direferensikan dari modul lain sudah final harganya —
 * pass-through, TIDAK dimargin lagi supaya tidak margin berlapis.
 * Lihat docs/arsitektur-ziarah.md §8.1, §8.3, §12.4.
 */
export async function computeTourPackageBreakdown(tourPackageId: string): Promise<TourPackageBreakdown> {
  const tourPackage = await prisma.tourPackage.findUniqueOrThrow({
    where: { id: tourPackageId },
    include: {
      transportTrip: {
        include: { pricing: { where: { isActive: true }, include: { vehicle: true } } },
      },
      includedTransportPricing: { include: { vehicle: true } },
      hotels: {
        include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } },
      },
      hotelOptions: {
        include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } },
      },
    },
  })

  const { components, totalSellPrice: componentsTotalSellPrice } = await computeCostComponents('tour_package', tourPackageId)

  // Harga jual HIDUP kendaraan/hotel pilihan dibaca dari titik harga (docs/arsitektur-harga-terpadu.md §15), bukan kolom cache lama.
  const [transportPrice, hotelPrice] = await Promise.all([
    sellPrices('transport', tourPackage.transportTrip?.pricing.map(p => p.id) ?? []),
    sellPrices('hotel', tourPackage.hotelOptions.map(o => o.hotelRoomScheduleId)),
  ])

  // Kendaraan — hanya SATU dari dua sumber ini yang relevan tergantung mode (§12.4).
  const includedTransportPrice = tourPackage.transportMode === 'included' && tourPackage.includedTransportPrice != null
    ? Number(tourPackage.includedTransportPrice)
    : null
  const includedVehicleName = tourPackage.transportMode === 'included' && tourPackage.includedTransportPricing
    ? tourPackage.includedTransportPricing.vehicle.name
    : null
  const vehicleOptions: VehicleOption[] = tourPackage.transportMode === 'user_choice'
    ? (tourPackage.transportTrip?.pricing.map(p => ({
        transportPricingId: p.id, vehicleName: p.vehicle.name, vehiclePrice: transportPrice.get(p.id) ?? 0,
      })) ?? [])
    : []

  // Hotel — included (dibakukan) TIDAK berubah dari §10, tetap dihitung meski mode saat ini
  // bukan 'included' (nilai historis) — tapi HANYA dijumlah ke base total kalau hotelMode='included'.
  const hotels: HotelBreakdown[] = tourPackage.hotels.map(h => ({
    id: h.id,
    hotelName: h.hotelRoomSchedule.period.hotel.name,
    roomTypeName: h.hotelRoomSchedule.roomType.name,
    nights: h.nights,
    numRooms: h.numRooms,
    pricePerNight: Number(h.pricePerNight),
    totalPrice: h.nights * h.numRooms * Number(h.pricePerNight),
  }))
  const hotelsTotalPrice = tourPackage.hotelMode === 'included'
    ? hotels.reduce((sum, h) => sum + h.totalPrice, 0)
    : 0

  const hotelOptions: HotelOption[] = tourPackage.hotelMode === 'user_choice'
    ? tourPackage.hotelOptions.map(o => ({
        hotelRoomScheduleId: o.hotelRoomScheduleId,
        hotelName: o.hotelRoomSchedule.period.hotel.name,
        roomTypeName: o.hotelRoomSchedule.roomType.name,
        nights: o.nights,
        pricePerNight: hotelPrice.get(o.hotelRoomScheduleId) ?? 0,
      }))
    : []

  return {
    components, componentsTotalSellPrice,
    transportMode: tourPackage.transportMode,
    includedTransportPricingId: tourPackage.transportMode === 'included' ? tourPackage.includedTransportPricingId : null,
    includedTransportPrice, includedVehicleName, vehicleOptions,
    hotelMode: tourPackage.hotelMode, hotels, hotelsTotalPrice, hotelOptions,
  }
}

/**
 * Harga jual paket DASAR — komponen + (kendaraan/hotel yang mode-nya 'included' saja). TIDAK
 * PERNAH menyertakan opsi 'user_choice' — itu yang memperbaiki keluhan "kendaraan tiba-tiba
 * masuk harga publish" (docs/arsitektur-ziarah.md §12.1/§12.4). Dipakai untuk cache
 * TourPackage.price ("mulai dari") DAN sebagai basis penjumlahan saat booking.
 */
export function baseTotal(breakdown: TourPackageBreakdown): number {
  return breakdown.componentsTotalSellPrice + breakdown.hotelsTotalPrice + (breakdown.includedTransportPrice ?? 0)
}

/** Alias historis — dipakai cache "mulai dari" katalog (docs/arsitektur-ziarah.md §8.5, §12.4). */
export function cheapestTotal(breakdown: TourPackageBreakdown): number {
  return baseTotal(breakdown)
}

/** Total akhir untuk satu opsi kendaraan tertentu (mode user_choice) — dipakai saat booking. */
export function totalForVehicle(breakdown: TourPackageBreakdown, transportPricingId: string): number | null {
  const vehicle = breakdown.vehicleOptions.find(v => v.transportPricingId === transportPricingId)
  if (!vehicle) return null
  return baseTotal(breakdown) + vehicle.vehiclePrice
}

/** Tambahan harga hotel pilihan pilgrim (mode user_choice) — nights × numRooms × harga live. */
export function hotelChoicePrice(breakdown: TourPackageBreakdown, hotelRoomScheduleId: string, numRooms: number): number | null {
  const option = breakdown.hotelOptions.find(o => o.hotelRoomScheduleId === hotelRoomScheduleId)
  if (!option) return null
  return option.nights * numRooms * option.pricePerNight
}
