import { prisma } from '@/lib/db'
import { getFeaturedCardUrls } from '@/lib/media/urls'
import { Bus } from 'lucide-react'
import TransportSearch, { type TripData } from '@/components/shared/TransportSearch'

type Props = { params: Promise<{ locale: string }> }

export default async function TransportCatalogPage({ params }: Props) {
  const { locale } = await params

  // Satu harga flat per kombinasi rute×kendaraan (docs/arsitektur-transportasi.md §9).
  const trips = await prisma.transportTrip.findMany({
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: {
      pricing: {
        where: { isActive: true },
        include: { vehicle: true },
        orderBy: { vehicle: { capacity: 'asc' } },
      },
    },
  })

  // Foto sampul tiap kendaraan — layanan media universal (satu query batch).
  const vehicleIds = [...new Set(trips.flatMap(t => t.pricing.map(p => p.vehicle.id)))]
  const coverMap = await getFeaturedCardUrls('vehicle', vehicleIds)
  const coverUrls: Record<string, string | null> = Object.fromEntries(coverMap)

  // Redesain rute-dulu (docs/decisions.md 2026-07-20): user mikirnya "butuh kendaraan dari A ke B"
  // dulu, baru pilih kendaraan — jadi kartu utama adalah RUTE, bukan kendaraan. Interaksi
  // pencarian/filter di TransportSearch (client component), data mentahnya disiapkan di sini.
  const tripData: TripData[] = trips.map(t => ({
    id: t.id, name: t.name, category: t.category, description: t.description,
    origin: t.origin, destination: t.destination,
    vehicles: t.pricing.map(p => ({
      pricingId: p.id, vehicleId: p.vehicle.id, vehicleName: p.vehicle.name,
      vehicleType: p.vehicle.vehicleType, capacity: p.vehicle.capacity, fleetCount: p.vehicle.fleetCount,
      price: Number(p.price), coverUrl: coverUrls[p.vehicle.id] ?? null,
    })),
  }))

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Bus className="h-8 w-8 text-teal-600" />
          Layanan Transport
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Cari kendaraan berdasarkan titik jemput dan tujuan — dari jemput bandara, antar kota,
          hingga city tour ziarah.
        </p>
      </div>

      {tripData.length === 0 ? (
        <div className="rounded-xl border border-dashed p-16 text-center text-muted-foreground">
          <Bus className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Jadwal transport akan segera tersedia.</p>
        </div>
      ) : (
        <TransportSearch trips={tripData} locale={locale} />
      )}
    </div>
  )
}
