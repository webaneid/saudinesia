import type { Metadata } from 'next'
import { Bus, CarFront, Route as RouteIcon, Tag } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { getFeaturedCardUrls } from '@/lib/media/urls'
import { sellPrices } from '@/lib/pricing/engine/read'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
import { formatRupiah } from '@/lib/utils'
import TransportSearch, { type TransportSearchLabels, type TripData } from '@/components/shared/TransportSearch'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'
import { CatalogSection } from '@/components/shared/public/CatalogSection'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return catalogMetadata((await params).locale, 'transport')
}

/** Kunci kategori DB (snake_case) → kunci pesan (camelCase, §6.5 C1). */
const CATEGORY_KEYS: Record<string, string> = { airport: 'airport', intercity: 'intercity', city_tour: 'cityTour', shuttle: 'shuttle', other: 'other' }

// Katalog Transport — pola katalog §6.7. Satu harga flat per rute × kendaraan (docs/arsitektur-transportasi.md §9); pencarian di TransportSearch (klien).
export default async function TransportCatalogPage({ params }: Props) {
  const { locale } = await params
  await requireCatalog('transport')
  const [trips, content, t] = await Promise.all([
    prisma.transportTrip.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      include: { pricing: { where: { isActive: true }, include: { vehicle: true }, orderBy: { vehicle: { capacity: 'asc' } } } },
    }),
    getPageContent(locale, 'transport'),
    getPageText(locale, 'transport'),
  ])

  const vehicleIds = [...new Set(trips.flatMap(tr => tr.pricing.map(p => p.vehicle.id)))]
  const [prices, coverMap] = await Promise.all([
    sellPrices('transport', trips.flatMap(tr => tr.pricing.map(p => p.id))),
    getFeaturedCardUrls('vehicle', vehicleIds),
  ])

  const tripData: TripData[] = trips.map(tr => ({
    id: tr.id, name: tr.name, category: tr.category, description: tr.description,
    origin: tr.origin, destination: tr.destination,
    vehicles: tr.pricing.map(p => ({
      pricingId: p.id, vehicleId: p.vehicle.id, vehicleName: p.vehicle.name,
      vehicleType: p.vehicle.vehicleType, capacity: p.vehicle.capacity, fleetCount: p.vehicle.fleetCount,
      price: prices.get(p.id) ?? 0, coverUrl: coverMap.get(p.vehicle.id) ?? null,
    })),
  }))

  const s = (k: string) => t(`search.${k}`)
  const capacities = [...new Set(tripData.flatMap(tr => tr.vehicles.map(v => v.capacity)))]
  const labels: TransportSearchLabels = {
    where: s('where'), from: s('from'), to: s('to'), anyOrigin: s('anyOrigin'), anyDestination: s('anyDestination'), swap: s('swap'),
    category: s('category'), all: s('all'), empty: s('empty'), reset: s('reset'), order: s('order'),
    capacity: Object.fromEntries(capacities.map(c => [c, t('search.capacity', { count: c })])),
    categories: Object.fromEntries(Object.entries(CATEGORY_KEYS).map(([db, key]) => [db, s(`categories.${key}`)])),
  }

  const priced = tripData.flatMap(tr => tr.vehicles.map(v => v.price)).filter(v => v > 0)
  const facts: HeroFact[] = []
  if (tripData.length > 0) {
    facts.push({ icon: RouteIcon, label: t('facts.routes', { count: tripData.length }) })
    if (vehicleIds.length > 0) facts.push({ icon: CarFront, label: t('facts.vehicles', { count: vehicleIds.length }) })
    if (priced.length > 0) facts.push({ icon: Tag, label: t('facts.priceFrom', { price: formatRupiah(Math.min(...priced)) }) })
  }

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} />

      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: Bus, text: t('list.empty') }}
        isEmpty={tripData.length === 0}
      >
        <TransportSearch trips={tripData} locale={locale} labels={labels} />
      </CatalogSection>

      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
