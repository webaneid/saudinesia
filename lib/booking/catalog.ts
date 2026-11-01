import { prisma } from '@/lib/db'
import { cateringSeasonPrices, sellPrices, visaFeeRules } from '@/lib/pricing/engine/read'
import { computePackageBreakdown } from '@/lib/pricing/computePackagePrice'
import { computeTourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'
import { calendarDateOf, dbDateOf, todayInApp } from '@/lib/time'

// Pilihan produk untuk form booking admin (docs/arsitektur-booking-engine-v2.md §10.3): satu pembaca per modul, HANYA harga jual (titik harga yang sama dengan
// katalog dan mesin pesan — pratinjau tetap sumber angka yang mengikat). Tanpa modal/HPP. Hanya produk aktif; jadwal yang sudah lewat tidak ditampilkan.

export const BOOKING_MODULES = ['visa', 'flight', 'hotel', 'transport', 'muthowif', 'catering', 'tourPackage', 'package'] as const
export type BookingModule = typeof BOOKING_MODULES[number]

const TRANSPORT_LIMIT = 500

export async function bookingCatalog(module: BookingModule): Promise<unknown> {
  const today = dbDateOf(todayInApp())
  switch (module) {
    case 'visa': {
      const rows = await prisma.visaProduct.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, visaType: true, requiredComponents: true } })
      const tiers = await visaFeeRules(rows.map(r => r.id))
      return rows.map(r => ({ ...r, tiers: tiers.get(r.id) ?? [] }))
    }
    case 'flight': {
      const rows = await prisma.flightSchedule.findMany({
        where: { isActive: true, departureTo: { gte: today } }, orderBy: [{ departureFrom: 'asc' }, { id: 'asc' }],
        select: { id: true, departureFrom: true, departureTo: true, totalSeats: true, pendingSeats: true, bookedSeats: true, route: { select: { origin: true, destination: true } } },
      })
      const price = await sellPrices('flight', rows.map(r => r.id))
      return rows.map(r => ({
        id: r.id, label: `${r.route.origin} → ${r.route.destination}`, from: calendarDateOf(r.departureFrom), to: calendarDateOf(r.departureTo),
        seatsLeft: r.totalSeats - r.pendingSeats - r.bookedSeats, price: price.get(r.id) ?? 0,
      }))
    }
    case 'hotel': {
      // Satu baris per jadwal kamar; form mengelompokkan Hotel → Kamar dan memilih periode dari tanggal (lib/booking/hotelPick.ts, docs/arsitektur-hotel.md §12.6).
      const rows = await prisma.hotelRoomSchedule.findMany({
        where: { isActive: true, period: { isActive: true, periodEnd: { gte: today }, hotel: { isActive: true } } }, orderBy: [{ period: { periodStart: 'asc' } }, { id: 'asc' }],
        select: { id: true, totalQuota: true, pendingQuota: true, bookedQuota: true, roomTypeId: true, roomType: { select: { name: true, defaultCapacity: true } }, period: { select: { periodStart: true, periodEnd: true, hotel: { select: { id: true, name: true, city: true, stars: true } } } } },
      })
      const price = await sellPrices('hotel', rows.map(r => r.id))
      return rows.map(r => ({
        id: r.id, hotelId: r.period.hotel.id, hotelName: r.period.hotel.name, city: r.period.hotel.city, stars: r.period.hotel.stars,
        roomTypeId: r.roomTypeId, roomType: r.roomType.name, capacity: r.roomType.defaultCapacity,
        from: calendarDateOf(r.period.periodStart), to: calendarDateOf(r.period.periodEnd), roomsLeft: r.totalQuota - r.pendingQuota - r.bookedQuota, price: price.get(r.id) ?? 0,
      }))
    }
    case 'transport': {
      const rows = await prisma.transportQuota.findMany({
        where: { travelDate: { gte: today }, pricing: { isActive: true, trip: { isActive: true } } }, orderBy: [{ travelDate: 'asc' }, { id: 'asc' }], take: TRANSPORT_LIMIT,
        select: { id: true, pricingId: true, travelDate: true, totalSeats: true, pendingSeats: true, bookedSeats: true, pricing: { select: { trip: { select: { id: true, name: true, category: true } }, vehicle: { select: { name: true, capacity: true } } } } },
      })
      const price = await sellPrices('transport', [...new Set(rows.map(r => r.pricingId))])
      return rows.map(r => ({
        id: r.id, pricingId: r.pricingId, tripId: r.pricing.trip.id, tripName: r.pricing.trip.name, category: r.pricing.trip.category, vehicle: r.pricing.vehicle.name,
        capacity: r.pricing.vehicle.capacity, date: calendarDateOf(r.travelDate), seatsLeft: r.totalSeats - r.pendingSeats - r.bookedSeats, price: price.get(r.pricingId) ?? 0,
      }))
    }
    case 'muthowif': {
      const svc = await prisma.muthowifServicePrice.findFirst({ select: { id: true } })
      return { pricePerPersonDay: svc ? ((await sellPrices('muthowif', [svc.id])).get(svc.id) ?? 0) : 0 }
    }
    case 'catering': {
      const rows = await prisma.cateringOption.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true } })
      const prices = await cateringSeasonPrices(rows.map(r => r.id))
      return rows.map(r => ({ ...r, prices: prices.get(r.id) }))
    }
    case 'tourPackage': {
      const rows = await prisma.tourPackage.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true } })
      const price = await sellPrices('tour_package', rows.map(r => r.id))
      return Promise.all(rows.map(async r => {
        const b = await computeTourPackageBreakdown(r.id)
        return {
          id: r.id, name: r.name, price: price.get(r.id) ?? 0, transportMode: b.transportMode, hotelMode: b.hotelMode,
          vehicleOptions: b.vehicleOptions.map(v => ({ pricingId: v.transportPricingId, name: v.vehicleName })),
          hotelOptions: b.hotelOptions.map(h => ({ id: h.hotelRoomScheduleId, name: `${h.hotelName} — ${h.roomTypeName}` })),
        }
      }))
    }
    case 'package': {
      const rows = await prisma.package.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true } })
      const price = await sellPrices('package', rows.map(r => r.id))
      return Promise.all(rows.map(async r => {
        const b = await computePackageBreakdown(r.id)
        return {
          id: r.id, name: r.name, pricePerPerson: price.get(r.id) ?? 0,
          modes: { hotelMakkah: b.hotelMakkahMode, hotelMadinah: b.hotelMadinahMode, transport: b.transportMode, muthowif: b.muthowifMode, visa: b.visaMode, flight: b.flightMode, catering: b.cateringMode },
          options: {
            hotelMakkah: b.hotelMakkahOptions.map(o => ({ id: o.hotelRoomScheduleId, name: `${o.hotelName} — ${o.roomTypeName} (${o.nights} malam)`, perPerson: o.perPersonPrice })),
            hotelMadinah: b.hotelMadinahOptions.map(o => ({ id: o.hotelRoomScheduleId, name: `${o.hotelName} — ${o.roomTypeName} (${o.nights} malam)`, perPerson: o.perPersonPrice })),
            transport: b.vehicleOptions.map(o => ({ id: o.transportPricingId, name: o.vehicleName, price: o.vehiclePrice })),
            visa: b.visaOptions.map(o => ({ id: o.visaProductId, name: o.name, price: o.price })),
            flight: b.flightOptions.map(o => ({ id: o.flightScheduleId, name: o.label, price: o.price })),
            catering: b.cateringOptions.map(o => ({ id: o.cateringOptionId, name: `${o.name} (${o.numDays} hari)`, perPerson: o.price })),
          },
        }
      }))
    }
  }
}
