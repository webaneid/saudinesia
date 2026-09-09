import { prisma } from '@/lib/db'
import { getLatestRate, getMarginRule, roundToNearest } from './pricingHelpers'

type CostTier = { minDays: number; maxDays: number; cost: number }

// Flat, tidak day-based — sama alasan Flight/Muthowif/Transport (docs/arsitektur-ziarah.md §8.3).
const PROBE_DAY = 1

export type ComponentBreakdown = {
  costComponent: string
  vendorId: string
  currency: string
  hppRupiah: number
  sellPrice: number
}

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

  const costs = await prisma.productCost.findMany({
    where: { productType: 'tour_package', productId: tourPackageId, isActive: true },
  })

  const marginRule = await getMarginRule('tour_package')
  const minMarginPercent = marginRule ? Number(marginRule.minMarginPercent) : 20
  const roundingIncrement = marginRule ? marginRule.roundingIncrement : 50000

  const components: ComponentBreakdown[] = []
  for (const c of costs) {
    const tiers = c.costTiers as unknown as CostTier[]
    const tier = tiers.find(t => PROBE_DAY >= t.minDays && PROBE_DAY <= t.maxDays)
    if (!tier) continue

    let hppRupiah: number
    if (c.currency === 'IDR') {
      hppRupiah = tier.cost
    } else {
      const rate = await getLatestRate(c.currency, 'IDR')
      if (!rate) continue // kurs tidak ditemukan — skip komponen ini, bukan error total
      hppRupiah = tier.cost * Number(rate.sellRate)
    }

    const sellPrice = roundToNearest(hppRupiah * (1 + minMarginPercent / 100), roundingIncrement)
    components.push({ costComponent: c.costComponent, vendorId: c.vendorId, currency: c.currency, hppRupiah, sellPrice })
  }

  const componentsTotalSellPrice = components.reduce((sum, c) => sum + c.sellPrice, 0)

  // Kendaraan — hanya SATU dari dua sumber ini yang relevan tergantung mode (§12.4).
  const includedTransportPrice = tourPackage.transportMode === 'included' && tourPackage.includedTransportPrice != null
    ? Number(tourPackage.includedTransportPrice)
    : null
  const includedVehicleName = tourPackage.transportMode === 'included' && tourPackage.includedTransportPricing
    ? tourPackage.includedTransportPricing.vehicle.name
    : null
  const vehicleOptions: VehicleOption[] = tourPackage.transportMode === 'user_choice'
    ? (tourPackage.transportTrip?.pricing.map(p => ({
        transportPricingId: p.id, vehicleName: p.vehicle.name, vehiclePrice: Number(p.price),
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
        pricePerNight: Number(o.hotelRoomSchedule.price),
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
