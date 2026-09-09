import { prisma } from '@/lib/db'
import { Plane, CalendarRange } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'

type Props = { params: Promise<{ locale: string }> }

function formatDate(d: Date) {
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function FlightCatalogPage({ params }: Props) {
  await params

  const schedules = await prisma.flightSchedule.findMany({
    where: { isActive: true, route: { isActive: true } },
    orderBy: { departureFrom: 'asc' },
    include: { route: true },
  })

  // Satu query batch untuk semua maskapai (Vendor lewat ProductCost) — bukan N+1 per jadwal.
  const costs = await prisma.productCost.findMany({
    where: {
      productType: 'flight',
      productId: { in: schedules.map(s => s.id) },
      costComponent: 'tiket',
      isActive: true,
    },
    include: { vendor: true },
  })
  const airlineByScheduleId = new Map(costs.map(c => [c.productId, c.vendor.name]))

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Plane className="h-8 w-8 text-teal-600" />
          Tiket Pesawat
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Jadwal penerbangan untuk keberangkatan umroh &amp; haji — harga per orang, berlaku untuk periode
          keberangkatan yang tertera.
        </p>
      </div>

      {schedules.length === 0 && (
        <div className="rounded-xl border border-dashed p-16 text-center text-muted-foreground">
          <Plane className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Jadwal penerbangan akan segera tersedia.</p>
        </div>
      )}

      {schedules.length > 0 && (
        <>
          {/* Desktop: tabel */}
          <div className="hidden md:block rounded-xl border bg-card overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Maskapai</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rute</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Periode Keberangkatan</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Harga</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {schedules.map(s => (
                  <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{airlineByScheduleId.get(s.id) ?? '—'}</td>
                    <td className="px-4 py-3 text-foreground">{s.route.origin} → {s.route.destination}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(s.departureFrom)} – {formatDate(s.departureTo)}</td>
                    <td className="px-4 py-3 text-right font-bold text-teal-700">{formatRupiah(Number(s.price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: card */}
          <div className="md:hidden space-y-3">
            {schedules.map(s => (
              <div key={s.id} className="rounded-xl border bg-card p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{s.route.origin} → {s.route.destination}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{airlineByScheduleId.get(s.id) ?? '—'}</p>
                  </div>
                  <p className="text-lg font-bold text-teal-700 shrink-0">{formatRupiah(Number(s.price))}</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-2 border-t">
                  <CalendarRange className="h-3.5 w-3.5 text-teal-500 shrink-0" />
                  {formatDate(s.departureFrom)} – {formatDate(s.departureTo)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Harga berlaku per orang untuk pemberangkatan pada periode yang tertera. Hubungi kami untuk pemesanan.
      </p>
    </div>
  )
}
