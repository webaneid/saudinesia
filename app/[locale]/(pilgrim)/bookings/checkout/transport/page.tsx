import { prisma } from '@/lib/db'
import { TransportCheckoutForm } from '@/components/booking/TransportCheckoutForm'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tripId?: string }>
}

// docs/arsitektur-booking.md §6 Step 6c — checkout pendek Transport-only, tanpa visa sama
// sekali (§6a) — pilgrim manifest pakai field "core", bukan field terikat produk visa apa pun.
export default async function TransportCheckoutPage({ searchParams }: Props) {
  const { tripId } = await searchParams

  const trips = await prisma.transportTrip.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, category: true, origin: true, destination: true },
  })

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Checkout Transport</h1>
        <p className="text-sm text-muted-foreground">Pesan transport saja, tanpa produk lain — pilih kendaraan, isi data penumpang, dan lanjut ke pembayaran.</p>
      </div>
      <TransportCheckoutForm trips={trips} preselectedTripId={tripId ?? null} />
    </div>
  )
}
