import { prisma } from '@/lib/db'
import { computeCostComponents, type ComponentBreakdown } from './costComponents'
import { cateringSeasonPrices, sellPrices } from './engine/read'

export type { ComponentBreakdown }

export type VehicleOption = { transportPricingId: string; vehicleName: string; vehiclePrice: number }

export type HotelSlotBreakdown = {
  scheduleId: string
  hotelName: string
  roomTypeName: string
  nights: number
  numRooms: number
  pricePerNight: number
  totalPrice: number
} | null

export type HotelSlotOption = {
  hotelRoomScheduleId: string
  hotelName: string
  roomTypeName: string
  nights: number
  pricePerNight: number // live dari HotelRoomSchedule.price
}

export type VisaOption = { visaProductId: string; name: string; price: number }
export type FlightOption = { flightScheduleId: string; label: string; price: number }
export type CateringOptionRow = { cateringOptionId: string; name: string; numPeople: number; numDays: number; price: number }

export type PackageBreakdown = {
  components: ComponentBreakdown[]
  componentsTotalSellPrice: number

  hotelMakkahMode: 'included' | 'user_choice' | 'none'
  hotelMakkah: HotelSlotBreakdown
  hotelMakkahOptions: HotelSlotOption[]

  hotelMadinahMode: 'included' | 'user_choice' | 'none'
  hotelMadinah: HotelSlotBreakdown
  hotelMadinahOptions: HotelSlotOption[]

  transportMode: 'included' | 'user_choice' | 'none'
  includedTransportPricingId: string | null
  includedTransportPrice: number | null
  includedVehicleName: string | null
  vehicleOptions: VehicleOption[]

  muthowifMode: 'included' | 'user_choice' | 'none'
  includedMuthowifPrice: number | null
  currentMuthowifPrice: number | null // live singleton, dipakai tampilan user_choice

  visaMode: 'included' | 'user_choice' | 'none'
  includedVisaProductId: string | null
  includedVisaPrice: number | null
  includedVisaName: string | null
  visaOptions: VisaOption[]

  flightMode: 'included' | 'user_choice' | 'none'
  includedFlightScheduleId: string | null
  includedFlightPrice: number | null
  includedFlightLabel: string | null
  flightOptions: FlightOption[]

  cateringMode: 'included' | 'user_choice' | 'none'
  includedCateringOptionId: string | null
  includedCateringNumPeople: number | null
  includedCateringNumDays: number | null
  includedCateringPrice: number | null
  includedCateringName: string | null
  cateringOptions: CateringOptionRow[]
}

/**
 * Sama pola computeTourPackageBreakdown() (docs/arsitektur-ziarah.md §8.3/§12.4) — margin PER
 * KOMPONEN custom dulu baru dijumlah, komponen yang direferensikan dari modul lain (Hotel/
 * Transport/Muthowif/Visa/Flight/Catering) sudah final harganya, pass-through, tidak dimargin
 * lagi. Lihat docs/arsitektur-paket-umroh.md §5.
 */
export async function computePackageBreakdown(packageId: string): Promise<PackageBreakdown> {
  const pkg = await prisma.package.findUniqueOrThrow({
    where: { id: packageId },
    include: {
      transportTrip: { include: { pricing: { where: { isActive: true }, include: { vehicle: true } } } },
      includedTransportPricing: { include: { vehicle: true } },
      includedHotelMakkahSchedule: { include: { period: { include: { hotel: true } }, roomType: true } },
      includedHotelMadinahSchedule: { include: { period: { include: { hotel: true } }, roomType: true } },
      hotelOptions: { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } } },
      includedVisaProduct: true,
      visaOptions: { include: { visaProduct: true } },
      flightRoute: { include: { schedules: { where: { isActive: true } } } },
      includedFlightSchedule: { include: { route: true } },
      includedCateringOption: true,
      cateringOptions: { include: { cateringOption: true } },
    },
  })

  const { components, totalSellPrice: componentsTotalSellPrice } = await computeCostComponents('package', packageId)

  // Harga jual HIDUP sub-modul dibaca dari titik harga (docs/arsitektur-harga-terpadu.md §15), bukan kolom cache lama.
  const muthowifSingleton = await prisma.muthowifServicePrice.findFirst({ select: { id: true } })
  const [hotelPrice, transportPrice, visaPrice, flightPrice, muthowifPrice, cateringPrice] = await Promise.all([
    sellPrices('hotel', pkg.hotelOptions.map(o => o.hotelRoomScheduleId)),
    sellPrices('transport', pkg.transportTrip?.pricing.map(p => p.id) ?? []),
    sellPrices('visa', pkg.visaOptions.map(o => o.visaProductId)),
    sellPrices('flight', pkg.flightRoute?.schedules.map(s => s.id) ?? []),
    sellPrices('muthowif', muthowifSingleton ? [muthowifSingleton.id] : []),
    cateringSeasonPrices(pkg.cateringOptions.map(o => o.cateringOptionId)),
  ])

  // Hotel Makkah
  const hotelMakkah: HotelSlotBreakdown = pkg.includedHotelMakkahSchedule && pkg.includedHotelMakkahNights != null && pkg.includedHotelMakkahNumRooms != null && pkg.includedHotelMakkahPrice != null
    ? {
        scheduleId: pkg.includedHotelMakkahSchedule.id,
        hotelName: pkg.includedHotelMakkahSchedule.period.hotel.name,
        roomTypeName: pkg.includedHotelMakkahSchedule.roomType.name,
        nights: pkg.includedHotelMakkahNights,
        numRooms: pkg.includedHotelMakkahNumRooms,
        pricePerNight: Number(pkg.includedHotelMakkahPrice),
        totalPrice: pkg.includedHotelMakkahNights * pkg.includedHotelMakkahNumRooms * Number(pkg.includedHotelMakkahPrice),
      }
    : null
  const hotelMakkahOptions: HotelSlotOption[] = pkg.hotelMakkahMode === 'user_choice'
    ? pkg.hotelOptions.filter(o => o.slot === 'makkah').map(o => ({
        hotelRoomScheduleId: o.hotelRoomScheduleId,
        hotelName: o.hotelRoomSchedule.period.hotel.name,
        roomTypeName: o.hotelRoomSchedule.roomType.name,
        nights: o.nights,
        pricePerNight: hotelPrice.get(o.hotelRoomScheduleId) ?? 0,
      }))
    : []

  // Hotel Madinah
  const hotelMadinah: HotelSlotBreakdown = pkg.includedHotelMadinahSchedule && pkg.includedHotelMadinahNights != null && pkg.includedHotelMadinahNumRooms != null && pkg.includedHotelMadinahPrice != null
    ? {
        scheduleId: pkg.includedHotelMadinahSchedule.id,
        hotelName: pkg.includedHotelMadinahSchedule.period.hotel.name,
        roomTypeName: pkg.includedHotelMadinahSchedule.roomType.name,
        nights: pkg.includedHotelMadinahNights,
        numRooms: pkg.includedHotelMadinahNumRooms,
        pricePerNight: Number(pkg.includedHotelMadinahPrice),
        totalPrice: pkg.includedHotelMadinahNights * pkg.includedHotelMadinahNumRooms * Number(pkg.includedHotelMadinahPrice),
      }
    : null
  const hotelMadinahOptions: HotelSlotOption[] = pkg.hotelMadinahMode === 'user_choice'
    ? pkg.hotelOptions.filter(o => o.slot === 'madinah').map(o => ({
        hotelRoomScheduleId: o.hotelRoomScheduleId,
        hotelName: o.hotelRoomSchedule.period.hotel.name,
        roomTypeName: o.hotelRoomSchedule.roomType.name,
        nights: o.nights,
        pricePerNight: hotelPrice.get(o.hotelRoomScheduleId) ?? 0,
      }))
    : []

  // Transport
  const includedTransportPrice = pkg.transportMode === 'included' && pkg.includedTransportPrice != null ? Number(pkg.includedTransportPrice) : null
  const includedVehicleName = pkg.transportMode === 'included' && pkg.includedTransportPricing ? pkg.includedTransportPricing.vehicle.name : null
  const vehicleOptions: VehicleOption[] = pkg.transportMode === 'user_choice'
    ? (pkg.transportTrip?.pricing.map(p => ({ transportPricingId: p.id, vehicleName: p.vehicle.name, vehiclePrice: transportPrice.get(p.id) ?? 0 })) ?? [])
    : []

  // Muthowif — singleton, tidak ada opsi untuk dipilih
  const includedMuthowifPrice = pkg.muthowifMode === 'included' && pkg.includedMuthowifPrice != null ? Number(pkg.includedMuthowifPrice) : null
  const currentMuthowifPrice = muthowifSingleton ? (muthowifPrice.get(muthowifSingleton.id) ?? 0) : null

  // Visa
  const includedVisaPrice = pkg.visaMode === 'included' && pkg.includedVisaPrice != null ? Number(pkg.includedVisaPrice) : null
  const includedVisaName = pkg.visaMode === 'included' && pkg.includedVisaProduct ? pkg.includedVisaProduct.name : null
  const visaOptions: VisaOption[] = pkg.visaMode === 'user_choice'
    ? pkg.visaOptions.map(o => ({ visaProductId: o.visaProductId, name: o.visaProduct.name, price: visaPrice.get(o.visaProductId) ?? 0 }))
    : []

  // Tiket Pesawat
  const includedFlightPrice = pkg.flightMode === 'included' && pkg.includedFlightPrice != null ? Number(pkg.includedFlightPrice) : null
  const includedFlightLabel = pkg.flightMode === 'included' && pkg.includedFlightSchedule
    ? `${pkg.includedFlightSchedule.route.origin} → ${pkg.includedFlightSchedule.route.destination}`
    : null
  const flightOptions: FlightOption[] = pkg.flightMode === 'user_choice'
    ? (pkg.flightRoute?.schedules.map(s => ({
        flightScheduleId: s.id,
        label: `${pkg.flightRoute!.origin} → ${pkg.flightRoute!.destination}`,
        price: flightPrice.get(s.id) ?? 0,
      })) ?? [])
    : []

  // Katering
  const includedCateringPrice = pkg.cateringMode === 'included' && pkg.includedCateringPrice != null ? Number(pkg.includedCateringPrice) : null
  const includedCateringName = pkg.cateringMode === 'included' && pkg.includedCateringOption ? pkg.includedCateringOption.name : null
  const cateringOptions: CateringOptionRow[] = pkg.cateringMode === 'user_choice'
    ? pkg.cateringOptions.map(o => ({
        cateringOptionId: o.cateringOptionId,
        name: o.cateringOption.name,
        numPeople: o.numPeople,
        numDays: o.numDays,
        price: o.numPeople * o.numDays * (cateringPrice.get(o.cateringOptionId)?.regular ?? 0),
      }))
    : []

  return {
    components, componentsTotalSellPrice,
    hotelMakkahMode: pkg.hotelMakkahMode, hotelMakkah, hotelMakkahOptions,
    hotelMadinahMode: pkg.hotelMadinahMode, hotelMadinah, hotelMadinahOptions,
    transportMode: pkg.transportMode,
    includedTransportPricingId: pkg.transportMode === 'included' ? pkg.includedTransportPricingId : null,
    includedTransportPrice, includedVehicleName, vehicleOptions,
    muthowifMode: pkg.muthowifMode, includedMuthowifPrice, currentMuthowifPrice,
    visaMode: pkg.visaMode,
    includedVisaProductId: pkg.visaMode === 'included' ? pkg.includedVisaProductId : null,
    includedVisaPrice, includedVisaName, visaOptions,
    flightMode: pkg.flightMode,
    includedFlightScheduleId: pkg.flightMode === 'included' ? pkg.includedFlightScheduleId : null,
    includedFlightPrice, includedFlightLabel, flightOptions,
    cateringMode: pkg.cateringMode,
    includedCateringOptionId: pkg.cateringMode === 'included' ? pkg.includedCateringOptionId : null,
    includedCateringNumPeople: pkg.cateringMode === 'included' ? pkg.includedCateringNumPeople : null,
    includedCateringNumDays: pkg.cateringMode === 'included' ? pkg.includedCateringNumDays : null,
    includedCateringPrice, includedCateringName, cateringOptions,
  }
}

/**
 * Harga jual paket DASAR — komponen custom + tiap komponen yang mode-nya 'included' saja. TIDAK
 * PERNAH menyertakan 'user_choice' (docs/arsitektur-paket-umroh.md §5). Dipakai untuk cache
 * Package.price ("mulai dari") dan basis penjumlahan booking nanti.
 */
export function baseTotal(b: PackageBreakdown): number {
  return b.componentsTotalSellPrice
    + (b.hotelMakkahMode === 'included' && b.hotelMakkah ? b.hotelMakkah.totalPrice : 0)
    + (b.hotelMadinahMode === 'included' && b.hotelMadinah ? b.hotelMadinah.totalPrice : 0)
    + (b.transportMode === 'included' ? (b.includedTransportPrice ?? 0) : 0)
    + (b.muthowifMode === 'included' ? (b.includedMuthowifPrice ?? 0) : 0)
    + (b.visaMode === 'included' ? (b.includedVisaPrice ?? 0) : 0)
    + (b.flightMode === 'included' ? (b.includedFlightPrice ?? 0) : 0)
    + (b.cateringMode === 'included' ? (b.includedCateringPrice ?? 0) : 0)
}
