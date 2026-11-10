import { prisma } from '@/lib/db'
import { computePackageBreakdown } from '@/lib/pricing/computePackagePrice'
import { computeTourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'
import type { HotelScheduleOpt } from '@/lib/booking/hotelPick'
import { cateringSeasonPrices, sellPrices, visaFeeRules } from '@/lib/pricing/engine/read'
import { flightAirlines } from '@/lib/catalog/flight'
import { isReturnRoute } from './flight'
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
export type HotelCheckout = {
  kind: 'hotel'; id: string; name: string; city: string; stars: number | null; description: string | null; cover: Cover
  /** Jadwal kamar hotel ini (tipe kamar × periode) yang masih berlaku dan berharga — periode dipilih halaman dari tanggal (lib/booking/hotelPick.ts). */
  schedules: HotelScheduleOpt[]
}
/** Satu kuota kendaraan Paket Ziarah pada satu tanggal. `price` 0 = kendaraan termasuk paket (tak ditagih terpisah). */
export type TourSlot = { quotaId: string; date: CalendarDate; vehicle: string; capacity: number; seatsLeft: number; price: number }
export type TourCheckout = {
  kind: 'tour'; id: string; name: string; description: string | null; cover: Cover
  /** Harga dasar PER PAKET (bukan per orang — mesin: `compositeLines` multiplier 1); pilihan kendaraan/hotel ditambahkan terpisah. */
  price: number
  /** Alasan paket tak dapat dipesan online, null = dapat. */
  blocked: string | null
  sites: string[]
  transportMode: 'included' | 'user_choice' | 'none'
  /** included: tanggal yang punya kuota kendaraan paket (dicari otomatis); user_choice: kendaraan pilihan per tanggal. */
  slots: TourSlot[]
  includedVehicle: string | null
  hotelMode: 'included' | 'user_choice' | 'none'
  includedHotels: string[]
  hotelOptions: Array<{ id: string; label: string; nights: number; pricePerNight: number; roomsLeft: number }>
}
/** Layanan muthowif — satu layanan umum (K11b-3); petugas ditentukan tim. `id` = baris layanan (`MuthowifServicePrice`). */
export type MuthowifCheckout = {
  kind: 'muthowif'; id: string; name: string; description: string | null
  /** Harga jual per orang per hari; 0 = belum berharga (tak dapat dipesan). */
  pricePerPersonDay: number
  /** Jumlah pembimbing aktif (tampilan saja; kapasitas harian dicek mesin per tanggal). */
  guides: number
}
export type CateringCheckout = {
  kind: 'catering'; id: string; name: string; boardType: string; menuStyle: string; description: string | null; cover: Cover
  /** Harga per orang per hari per musim; musim dipilih mesin dari TANGGAL MULAI (angka mengikat = pratinjau). 0 = musim itu belum berharga. */
  prices: { regular: number; ramadan: number; hajj: number }
}
/** Satu jadwal tiket (periode harga/kuota). Tanggal terbang dipilih di dalam [from, to] ∩ ≥ hari ini. */
export type FlightOpt = { id: string; label: string; airline: string | null; from: CalendarDate; to: CalendarDate; seatsLeft: number; price: number }
export type FlightCheckout = {
  kind: 'flight'; id: string; name: string; origin: string; destination: string; description: string | null
  schedule: FlightOpt
  /** Alasan jadwal ini tak dapat dipesan online, null = dapat. */
  blocked: string | null
  /** Jadwal pulang (rute kebalikan, berharga, periode belum lewat) — opsional (K11b-1 = b). */
  returns: FlightOpt[]
}
export type CheckoutProduct = PackageCheckout | VisaCheckout | TransportCheckout | HajiCheckout | HotelCheckout | TourCheckout | MuthowifCheckout | CateringCheckout | FlightCheckout

/** Batas jumlah jadwal pulang yang ditawarkan (periode terdekat lebih dulu). */
const RETURN_SCHEDULES = 100
/** Batas jumlah slot kuota transport yang ditampilkan (tanggal terdekat lebih dulu). */
const TRANSPORT_SLOTS = 400

export async function loadCheckoutProduct(kind: CheckoutKind, id: string): Promise<CheckoutProduct | null> {
  switch (kind) {
    case 'package': return loadPackage(id)
    case 'visa': return loadVisa(id)
    case 'transport': return loadTransport(id)
    case 'haji': return loadHaji(id)
    case 'hotel': return loadHotel(id)
    case 'tour': return loadTour(id)
    case 'muthowif': return loadMuthowif(id)
    case 'catering': return loadCatering(id)
    case 'flight': return loadFlight(id)
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

async function loadHotel(id: string): Promise<HotelCheckout | null> {
  const h = await prisma.hotel.findUnique({ where: { id }, select: { id: true, name: true, city: true, stars: true, description: true, isActive: true } })
  if (!h?.isActive) return null
  const rows = await prisma.hotelRoomSchedule.findMany({
    where: { isActive: true, period: { isActive: true, hotelId: id, periodEnd: { gte: dbDateOf(todayInApp()) } } },
    orderBy: [{ period: { periodStart: 'asc' } }, { id: 'asc' }],
    select: { id: true, totalQuota: true, pendingQuota: true, bookedQuota: true, roomTypeId: true, roomType: { select: { name: true, defaultCapacity: true } }, period: { select: { periodStart: true, periodEnd: true } } },
  })
  const [price, covers] = await Promise.all([sellPrices('hotel', rows.map(r => r.id)), getFeaturedCards('hotel', [id])])
  return {
    kind: 'hotel', id: h.id, name: h.name, city: h.city, stars: h.stars, description: h.description, cover: covers.get(id) ?? null,
    schedules: rows
      .map(r => ({
        id: r.id, hotelId: h.id, hotelName: h.name, city: h.city, stars: h.stars, roomTypeId: r.roomTypeId, roomType: r.roomType.name, capacity: r.roomType.defaultCapacity,
        from: calendarDateOf(r.period.periodStart), to: calendarDateOf(r.period.periodEnd), roomsLeft: r.totalQuota - r.pendingQuota - r.bookedQuota, price: price.get(r.id) ?? 0,
      }))
      .filter(r => r.price > 0), // kamar belum berharga tak ditawarkan (mesin juga menolaknya)
  }
}

async function loadTour(id: string): Promise<TourCheckout | null> {
  const tp = await prisma.tourPackage.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, isActive: true, sites: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { tourismSite: { select: { name: true } } } } },
  })
  if (!tp?.isActive) return null
  const [b, price, covers] = await Promise.all([computeTourPackageBreakdown(id), sellPrices('tour_package', [id]), getFeaturedCards('tour_package', [id])])
  const today = dbDateOf(todayInApp())

  // Kendaraan: included → kuota kendaraan paket (harga sudah di paket); user_choice → kuota setiap opsi kendaraan (harga per kendaraan).
  const pricingIds = b.transportMode === 'included' && b.includedTransportPricingId ? [b.includedTransportPricingId]
    : b.transportMode === 'user_choice' ? b.vehicleOptions.map(v => v.transportPricingId) : []
  const optionPrice = new Map(b.vehicleOptions.map(v => [v.transportPricingId, v.vehiclePrice]))
  const quotas = pricingIds.length === 0 ? [] : await prisma.transportQuota.findMany({
    where: { pricingId: { in: pricingIds }, travelDate: { gte: today }, pricing: { isActive: true } },
    orderBy: [{ travelDate: 'asc' }, { id: 'asc' }], take: TRANSPORT_SLOTS,
    select: { id: true, pricingId: true, travelDate: true, totalSeats: true, pendingSeats: true, bookedSeats: true, pricing: { select: { vehicle: { select: { name: true, capacity: true } } } } },
  })
  const slots: TourSlot[] = quotas
    .map(q => ({
      quotaId: q.id, date: calendarDateOf(q.travelDate), vehicle: q.pricing.vehicle.name, capacity: q.pricing.vehicle.capacity,
      seatsLeft: q.totalSeats - q.pendingSeats - q.bookedSeats, price: b.transportMode === 'user_choice' ? (optionPrice.get(q.pricingId) ?? 0) : 0,
    }))
    .filter(x => b.transportMode !== 'user_choice' || x.price > 0)

  const hotelIds = b.hotelMode === 'user_choice' ? b.hotelOptions.map(o => o.hotelRoomScheduleId) : []
  const rooms = new Map((hotelIds.length === 0 ? [] : await prisma.hotelRoomSchedule.findMany({
    where: { id: { in: hotelIds }, isActive: true, period: { isActive: true, hotel: { isActive: true } } },
    select: { id: true, totalQuota: true, pendingQuota: true, bookedQuota: true },
  })).map(r => [r.id, r.totalQuota - r.pendingQuota - r.bookedQuota]))

  const sell = price.get(id) ?? 0
  return {
    kind: 'tour', id: tp.id, name: tp.name, description: tp.description, cover: covers.get(id) ?? null, price: sell,
    blocked: !(sell > 0) ? 'Harga paket ini belum ditetapkan — belum dapat dipesan.'
      : b.transportMode === 'included' && slots.length === 0 ? 'Belum ada jadwal kendaraan untuk paket ini — hubungi kami.' : null,
    sites: tp.sites.map(x => x.tourismSite.name),
    transportMode: b.transportMode, slots, includedVehicle: b.transportMode === 'included' ? b.includedVehicleName : null,
    hotelMode: b.hotelMode,
    includedHotels: b.hotelMode === 'included' ? b.hotels.map(h => `${h.hotelName} — ${h.roomTypeName} (${h.nights} malam)`) : [],
    hotelOptions: b.hotelOptions
      .filter(o => rooms.has(o.hotelRoomScheduleId) && o.pricePerNight > 0)
      .map(o => ({ id: o.hotelRoomScheduleId, label: `${o.hotelName} — ${o.roomTypeName}`, nights: o.nights, pricePerNight: o.pricePerNight, roomsLeft: rooms.get(o.hotelRoomScheduleId) ?? 0 })),
  }
}

async function loadMuthowif(id: string): Promise<MuthowifCheckout | null> {
  const svc = await prisma.muthowifServicePrice.findUnique({ where: { id }, select: { id: true } })
  if (!svc) return null
  const [price, guides] = await Promise.all([sellPrices('muthowif', [id]), prisma.muthowif.count({ where: { isActive: true } })])
  return { kind: 'muthowif', id, name: 'Layanan Muthowif', description: null, pricePerPersonDay: price.get(id) ?? 0, guides }
}

async function loadCatering(id: string): Promise<CateringCheckout | null> {
  const o = await prisma.cateringOption.findUnique({ where: { id }, select: { id: true, name: true, boardType: true, menuStyle: true, description: true, isActive: true } })
  if (!o?.isActive) return null
  const [prices, covers] = await Promise.all([cateringSeasonPrices([id]), getFeaturedCards('catering', [id])])
  return {
    kind: 'catering', id: o.id, name: o.name, boardType: o.boardType, menuStyle: o.menuStyle, description: o.description, cover: covers.get(id) ?? null,
    prices: prices.get(id) ?? { regular: 0, ramadan: 0, hajj: 0 },
  }
}

async function loadFlight(id: string): Promise<FlightCheckout | null> {
  const sel = { id: true, departureFrom: true, departureTo: true, totalSeats: true, pendingSeats: true, bookedSeats: true, route: { select: { origin: true, destination: true } } } as const
  const s = await prisma.flightSchedule.findUnique({ where: { id }, select: { ...sel, isActive: true, route: { select: { origin: true, destination: true, isActive: true } } } })
  if (!s?.isActive || !s.route.isActive) return null
  const today = todayInApp()
  // Kandidat pulang: rute kebalikan (aturan yang sama dengan pemeriksaan server; rute = master kecil, dicocokkan di aplikasi karena teks bebas), lalu
  // jadwal aktif rute itu yang periodenya belum lewat.
  const backRoutes = (await prisma.flightRoute.findMany({ where: { isActive: true }, select: { id: true, origin: true, destination: true } }))
    .filter(r => isReturnRoute(s.route, r)).map(r => r.id)
  const candidates = backRoutes.length === 0 ? [] : await prisma.flightSchedule.findMany({
    where: { isActive: true, departureTo: { gte: dbDateOf(today) }, routeId: { in: backRoutes }, id: { not: id } },
    orderBy: [{ departureFrom: 'asc' }, { id: 'asc' }], take: RETURN_SCHEDULES, select: sel,
  })
  const ids = [id, ...candidates.map(r => r.id)]
  const [price, airlines] = await Promise.all([sellPrices('flight', ids), flightAirlines(ids)])
  const opt = (r: typeof candidates[number]): FlightOpt => ({
    id: r.id, label: `${r.route.origin.trim()} → ${r.route.destination.trim()}`, airline: airlines.get(r.id) ?? null,
    from: calendarDateOf(r.departureFrom), to: calendarDateOf(r.departureTo), seatsLeft: r.totalSeats - r.pendingSeats - r.bookedSeats, price: price.get(r.id) ?? 0,
  })
  const schedule = opt(s)
  return {
    kind: 'flight', id: s.id, name: schedule.label, origin: s.route.origin, destination: s.route.destination, description: null, schedule,
    blocked: !(schedule.price > 0) ? 'Harga tiket ini belum ditetapkan — belum dapat dipesan.'
      : schedule.to < today ? 'Periode jadwal tiket ini sudah lewat.'
      : schedule.seatsLeft < 1 ? 'Kursi jadwal ini sudah habis.' : null,
    returns: candidates.map(opt).filter(r => r.price > 0 && r.seatsLeft > 0), // belum berharga / penuh tak ditawarkan (mesin juga menolak)
  }
}

/** Tanggal paling awal yang boleh dipilih (hari ini, zona aplikasi) — dipakai batas `min` isian tanggal. */
export const earliestDate = (): CalendarDate => todayInApp()
/** Tanggal pulang paket = berangkat + jumlah malam (tampilan; server menghitung sendiri). */
export const packageReturn = (departure: CalendarDate, nights: number): CalendarDate => addDays(departure, nights)
