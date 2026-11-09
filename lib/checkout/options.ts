import { prisma } from '@/lib/db'
import { computePackageBreakdown } from '@/lib/pricing/computePackagePrice'
import { sellPrices, visaFeeRules } from '@/lib/pricing/engine/read'
import { getFeaturedCards, getFeaturedCardUrls } from '@/lib/media/urls'
import { parseRequiredComponents, visaSalesModel } from '@/lib/validators/visa'
import { addDays, calendarDateOf, dbDateOf, todayInApp, type CalendarDate } from '@/lib/time'
import type { CheckoutKind } from './kinds'

// Data halaman checkout satu produk (docs/arsitektur-booking-engine-v2.md §10.5). HANYA harga JUAL dari titik harga (pembaca resmi `lib/pricing/engine/read`) — angka di sini
// hanya petunjuk tampilan; yang mengikat adalah pratinjau server (`POST /bookings/preview`). Produk nonaktif/tak ada → null (halaman 404).
// Jadwal/kuota yang sudah lewat tidak ditawarkan (zona aplikasi).

export type Cover = { src: string; alt: string | null } | null
/** Satu opsi pilihan. `hint` = harga jual untuk ditampilkan di samping label (per orang / per kendaraan), 0 = tanpa angka. */
export type Choice = { id: string; label: string; hint: number }

export type PackageCheckout = {
  kind: 'package'; id: string; name: string; description: string | null; cover: Cover; pricePerPerson: number
  /** Alasan paket tak dapat dipesan online (mis. muthowif pilihan), null = dapat. */
  blocked: string | null
  nights: number
  /** Periode tiket yang menentukan tanggal berangkat: tiket `included`, atau per opsi tiket (`user_choice`). */
  includedFlight: { label: string; from: CalendarDate; to: CalendarDate } | null
  choices: {
    hotelMakkah: Choice[]; hotelMadinah: Choice[]; transport: Choice[]; visa: Choice[]; catering: Choice[]
    flight: Array<Choice & { from: CalendarDate; to: CalendarDate }>
  }
  /** Komponen yang sudah termasuk (label untuk ringkasan isi). */
  included: string[]
}
export type VisaCheckout = {
  kind: 'visa'; id: string; name: string; country: string; visaType: string; description: string | null; cover: Cover; processDays: number
  /** Visa plus: wajib dibeli bersama komponen lain — tak dapat dipesan sendirian lewat checkout satu produk. */
  bundledWith: string[]
  tiers: Array<{ minDays: number; maxDays: number; fee: number }>
}
export type TransportCheckout = {
  kind: 'transport'; id: string; name: string; origin: string; destination: string; description: string | null
  slots: Array<{ quotaId: string; date: CalendarDate; vehicle: string; vehicleType: string; capacity: number; seatsLeft: number; price: number; cover: string | null }>
}
export type HajiCheckout = {
  kind: 'haji'; id: string; name: string; hajiType: string; year: number; description: string | null; cover: Cover; price: number
  departureDate: CalendarDate | null; returnDate: CalendarDate | null; durationDays: number | null; includes: string[]; seatsLeft: number
}
export type CheckoutProduct = PackageCheckout | VisaCheckout | TransportCheckout | HajiCheckout

/** Batas jumlah slot kuota transport yang ditampilkan (tanggal terdekat lebih dulu). */
const TRANSPORT_SLOTS = 400

export async function loadCheckoutProduct(kind: CheckoutKind, id: string): Promise<CheckoutProduct | null> {
  switch (kind) {
    case 'package': return loadPackage(id)
    case 'visa': return loadVisa(id)
    case 'transport': return loadTransport(id)
    case 'haji': return loadHaji(id)
  }
}

async function loadPackage(id: string): Promise<PackageCheckout | null> {
  const pkg = await prisma.package.findUnique({ where: { id }, select: { id: true, name: true, description: true, isActive: true } })
  if (!pkg?.isActive) return null
  const [b, price, covers] = await Promise.all([computePackageBreakdown(id), sellPrices('package', [id]), getFeaturedCards('package', [id])])
  const today = todayInApp()

  const flightIds = [b.includedFlightScheduleId, ...b.flightOptions.map(o => o.flightScheduleId)].filter((x): x is string => !!x)
  const schedules = new Map((await prisma.flightSchedule.findMany({
    where: { id: { in: flightIds }, isActive: true }, select: { id: true, departureFrom: true, departureTo: true },
  })).map(s => [s.id, { from: calendarDateOf(s.departureFrom), to: calendarDateOf(s.departureTo) }]))
  // Tanggal berangkat paling awal = hari ini (tak menawarkan masa lalu), terakhir = akhir periode tiket.
  const window = (sid: string | null) => {
    const s = sid ? schedules.get(sid) : undefined
    if (!s || s.to < today) return null
    return { from: s.from < today ? today : s.from, to: s.to }
  }

  const makkahNights = b.hotelMakkahMode === 'included' ? (b.hotelMakkah?.nights ?? 0) : 0
  const madinahNights = b.hotelMadinahMode === 'included' ? (b.hotelMadinah?.nights ?? 0) : 0
  const included = [
    b.flightMode === 'included' && 'Tiket pesawat',
    b.hotelMakkahMode === 'included' && b.hotelMakkah && `Hotel Makkah ${b.hotelMakkah.nights} malam`,
    b.hotelMadinahMode === 'included' && b.hotelMadinah && `Hotel Madinah ${b.hotelMadinah.nights} malam`,
    b.visaMode === 'included' && 'Visa',
    b.transportMode === 'included' && 'Transportasi',
    b.muthowifMode === 'included' && 'Muthowif',
    b.cateringMode === 'included' && 'Katering',
  ].filter((x): x is string => typeof x === 'string')

  const inc = b.flightMode === 'included' ? window(b.includedFlightScheduleId) : null
  return {
    kind: 'package', id: pkg.id, name: pkg.name, description: pkg.description, cover: covers.get(id) ?? null, pricePerPerson: price.get(id) ?? 0,
    blocked: b.muthowifMode === 'user_choice' ? 'Paket ini memakai muthowif pilihan — belum dapat dipesan online, hubungi kami.'
      : b.flightMode === 'included' && !inc ? 'Jadwal tiket paket ini sudah lewat — belum dapat dipesan.' : null,
    nights: makkahNights + madinahNights,
    includedFlight: inc && b.includedFlightLabel ? { label: b.includedFlightLabel, ...inc } : inc ? { label: 'Tiket pesawat', ...inc } : null,
    included,
    choices: {
      hotelMakkah: b.hotelMakkahMode === 'user_choice' ? b.hotelMakkahOptions.map(o => ({ id: o.hotelRoomScheduleId, label: `${o.hotelName} — ${o.roomTypeName} (${o.nights} malam)`, hint: o.perPersonPrice })) : [],
      hotelMadinah: b.hotelMadinahMode === 'user_choice' ? b.hotelMadinahOptions.map(o => ({ id: o.hotelRoomScheduleId, label: `${o.hotelName} — ${o.roomTypeName} (${o.nights} malam)`, hint: o.perPersonPrice })) : [],
      transport: b.transportMode === 'user_choice' ? b.vehicleOptions.map(o => ({ id: o.transportPricingId, label: o.vehicleName, hint: o.vehiclePrice })) : [],
      visa: b.visaMode === 'user_choice' ? b.visaOptions.map(o => ({ id: o.visaProductId, label: o.name, hint: o.price })) : [],
      catering: b.cateringMode === 'user_choice' ? b.cateringOptions.map(o => ({ id: o.cateringOptionId, label: `${o.name} (${o.numDays} hari)`, hint: o.price })) : [],
      flight: b.flightMode === 'user_choice'
        ? b.flightOptions.flatMap(o => { const w = window(o.flightScheduleId); return w ? [{ id: o.flightScheduleId, label: o.label, hint: o.price, ...w }] : [] })
        : [],
    },
  }
}

async function loadVisa(id: string): Promise<VisaCheckout | null> {
  const v = await prisma.visaProduct.findUnique({ where: { id }, select: { id: true, name: true, country: true, visaType: true, description: true, processDays: true, isActive: true, requiredComponents: true } })
  if (!v?.isActive) return null
  const [tiers, covers] = await Promise.all([visaFeeRules([id]), getFeaturedCards('visa', [id])])
  const model = visaSalesModel(parseRequiredComponents(v.requiredComponents).components)
  return {
    kind: 'visa', id: v.id, name: v.name, country: v.country, visaType: v.visaType, description: v.description, cover: covers.get(id) ?? null,
    processDays: v.processDays, bundledWith: model.plus ? model.parts : [], tiers: (tiers.get(id) ?? []).filter(t => t.fee > 0),
  }
}

async function loadTransport(id: string): Promise<TransportCheckout | null> {
  const trip = await prisma.transportTrip.findUnique({ where: { id }, select: { id: true, name: true, origin: true, destination: true, description: true, isActive: true } })
  if (!trip?.isActive) return null
  const rows = await prisma.transportQuota.findMany({
    where: { travelDate: { gte: dbDateOf(todayInApp()) }, pricing: { isActive: true, tripId: id } },
    orderBy: [{ travelDate: 'asc' }, { id: 'asc' }], take: TRANSPORT_SLOTS,
    select: { id: true, pricingId: true, travelDate: true, totalSeats: true, pendingSeats: true, bookedSeats: true, pricing: { select: { vehicle: { select: { id: true, name: true, vehicleType: true, capacity: true } } } } },
  })
  const [price, covers] = await Promise.all([
    sellPrices('transport', [...new Set(rows.map(r => r.pricingId))]),
    getFeaturedCardUrls('vehicle', [...new Set(rows.map(r => r.pricing.vehicle.id))]),
  ])
  return {
    kind: 'transport', id: trip.id, name: trip.name, origin: trip.origin, destination: trip.destination, description: trip.description,
    slots: rows
      .map(r => ({
        quotaId: r.id, date: calendarDateOf(r.travelDate), vehicle: r.pricing.vehicle.name, vehicleType: r.pricing.vehicle.vehicleType, capacity: r.pricing.vehicle.capacity,
        seatsLeft: r.totalSeats - r.pendingSeats - r.bookedSeats, price: price.get(r.pricingId) ?? 0, cover: covers.get(r.pricing.vehicle.id) ?? null,
      }))
      .filter(s => s.price > 0), // kendaraan belum berharga tak ditawarkan (mesin juga menolaknya — tak pernah gratis)
  }
}

async function loadHaji(id: string): Promise<HajiCheckout | null> {
  const h = await prisma.hajiProduct.findUnique({ where: { id } })
  if (!h?.isActive) return null
  const [price, covers] = await Promise.all([sellPrices('haji', [id]), getFeaturedCards('haji', [id])])
  return {
    kind: 'haji', id: h.id, name: h.name, hajiType: h.hajiType, year: h.year, description: h.description, cover: covers.get(id) ?? null, price: price.get(id) ?? 0,
    departureDate: h.departureDate ? calendarDateOf(h.departureDate) : null, returnDate: h.returnDate ? calendarDateOf(h.returnDate) : null,
    durationDays: h.durationDays, includes: Array.isArray(h.includes) ? h.includes.filter((x): x is string => typeof x === 'string') : [],
    seatsLeft: h.totalQuota - h.pendingQuota - h.bookedQuota,
  }
}

/** Tanggal paling awal yang boleh dipilih (hari ini, zona aplikasi) — dipakai batas `min` isian tanggal. */
export const earliestDate = (): CalendarDate => todayInApp()
/** Tanggal pulang paket = berangkat + jumlah malam (tampilan; server menghitung sendiri). */
export const packageReturn = (departure: CalendarDate, nights: number): CalendarDate => addDays(departure, nights)
