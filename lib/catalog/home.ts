import { prisma } from '@/lib/db'
import { getFeaturedCards } from '@/lib/media/urls'
import { getMuthowifServicePrice, sellPrices, visaPriceSummary } from '@/lib/pricing/engine/read'
import { parseRequiredComponents, visaSalesModel } from '@/lib/validators/visa'
import { dbDateOf, todayInApp } from '@/lib/time'

// Data homepage publik (docs/arsitektur-frontend-publik.md §3). Hanya data aktif dan hanya HARGA JUAL (K4), lewat lib/pricing/engine/read.ts.
// `null` pada harga = belum berharga: tampilan menyembunyikan harganya, tidak pernah menulis "Rp 0".

const PACKAGE_LIMIT = 3
const VISA_LIMIT = 3
const HOTEL_LIMIT_PER_CITY = 3
const HIGHLIGHT_LIMIT = 3

export type HomeImage = { src: string; alt: string | null } | null

export type HomePackage = {
  id: string
  name: string
  highlights: string[]
  priceLabel: string | null
  price: number | null
  isFeatured: boolean
  hasAddOns: boolean
  image: HomeImage
}

export type HomeVisa = {
  id: string
  name: string
  priceLabel: string | null
  price: number | null
  isRange: boolean
  processDays: number
  /** Bisa lewat checkout pendek: tanpa produk wajib lain DAN sudah berharga. */
  canBuyDirectly: boolean
  image: HomeImage
}

export type HomeHotel = {
  id: string
  name: string
  stars: number | null
  distanceToHaramM: number | null
  price: number | null
  image: HomeImage
}

export type HomeData = {
  packages: HomePackage[]
  visas: HomeVisa[]
  hotels: { makkah: HomeHotel[]; madinah: HomeHotel[] }
  muthowif: { pricePerDay: number } | null
}

const priced = (v: number | undefined | null): number | null => (v && v > 0 ? v : null)

async function loadPackages(): Promise<HomePackage[]> {
  const rows = await prisma.package.findMany({
    where: { isActive: true },
    orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    take: PACKAGE_LIMIT,
    select: {
      id: true, name: true, highlights: true, priceLabel: true, isFeatured: true,
      hotelMakkahMode: true, hotelMadinahMode: true, transportMode: true, muthowifMode: true, visaMode: true, flightMode: true, cateringMode: true,
    },
  })
  const ids = rows.map(r => r.id)
  const [prices, covers] = await Promise.all([sellPrices('package', ids), getFeaturedCards('package', ids)])
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    highlights: Array.isArray(r.highlights) ? r.highlights.filter((h): h is string => typeof h === 'string').slice(0, HIGHLIGHT_LIMIT) : [],
    priceLabel: r.priceLabel,
    price: priced(prices.get(r.id)),
    isFeatured: r.isFeatured,
    hasAddOns: [r.hotelMakkahMode, r.hotelMadinahMode, r.transportMode, r.muthowifMode, r.visaMode, r.flightMode, r.cateringMode].includes('user_choice'),
    image: covers.get(r.id) ?? null,
  }))
}

async function loadVisas(): Promise<HomeVisa[]> {
  const rows = await prisma.visaProduct.findMany({
    where: { isActive: true },
    orderBy: [{ country: 'asc' }, { visaType: 'asc' }, { id: 'asc' }],
    take: VISA_LIMIT,
    select: { id: true, name: true, priceLabel: true, processDays: true, requiredComponents: true },
  })
  const ids = rows.map(r => r.id)
  const [prices, covers] = await Promise.all([visaPriceSummary(ids), getFeaturedCards('visa', ids)])
  return rows.map(r => {
    const summary = prices.get(r.id)
    const price = priced(summary?.from)
    return {
      id: r.id,
      name: r.name,
      priceLabel: r.priceLabel,
      price,
      isRange: summary?.isRange ?? false,
      processDays: r.processDays,
      canBuyDirectly: price !== null && !visaSalesModel(parseRequiredComponents(r.requiredComponents).components).plus,
      image: covers.get(r.id) ?? null,
    }
  })
}

async function loadHotels(city: 'makkah' | 'madinah'): Promise<HomeHotel[]> {
  const today = dbDateOf(todayInApp())
  const rows = await prisma.hotel.findMany({
    where: { isActive: true, city },
    orderBy: [{ stars: 'desc' }, { distanceToHaramM: 'asc' }, { id: 'asc' }],
    take: HOTEL_LIMIT_PER_CITY,
    select: {
      id: true, name: true, stars: true, distanceToHaramM: true,
      pricePeriods: {
        where: { isActive: true, periodStart: { lte: today }, periodEnd: { gte: today } },
        select: { schedules: { where: { isActive: true }, select: { id: true } } },
      },
    },
  })
  const prices = await sellPrices('hotel', rows.flatMap(h => h.pricePeriods.flatMap(p => p.schedules.map(s => s.id))))
  const covers = await getFeaturedCards('hotel', rows.map(h => h.id))
  return rows.map(h => {
    const scheduled = h.pricePeriods.flatMap(p => p.schedules).map(s => prices.get(s.id) ?? 0).filter(v => v > 0)
    return {
      id: h.id,
      name: h.name,
      stars: h.stars,
      distanceToHaramM: h.distanceToHaramM,
      price: scheduled.length ? Math.min(...scheduled) : null,
      image: covers.get(h.id) ?? null,
    }
  })
}

async function loadMuthowif(): Promise<HomeData['muthowif']> {
  const [active, service] = await Promise.all([prisma.muthowif.count({ where: { isActive: true } }), getMuthowifServicePrice()])
  const pricePerDay = priced(service?.price)
  return active > 0 && pricePerDay !== null ? { pricePerDay } : null
}

export async function getHomeData(): Promise<HomeData> {
  const [packages, visas, makkah, madinah, muthowif] = await Promise.all([
    loadPackages(), loadVisas(), loadHotels('makkah'), loadHotels('madinah'), loadMuthowif(),
  ])
  return { packages, visas, hotels: { makkah, madinah }, muthowif }
}
