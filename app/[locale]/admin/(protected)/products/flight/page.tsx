'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Plane, Plus, MapPin } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'
import { Badge } from '@/components/admin/ui/Badge'

type FlightRoute = { id: string; origin: string; destination: string; isActive: boolean }
type FlightSchedule = {
  id: string; routeId: string; departureFrom: string; departureTo: string
  price: number; totalSeats: number; pendingSeats: number; bookedSeats: number; isActive: boolean
  route: FlightRoute; airlineName: string | null
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function FlightPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/flight`
  // Jumlah rute aktif (tanpa memedulikan filter tabel) — jadwal baru butuh minimal satu rute aktif.
  const [activeRoutes, setActiveRoutes] = useState<number | null>(null)
  const [routesTick, setRoutesTick] = useState(0)
  useEffect(() => {
    fetch('/api/v1/admin/products/flight/routes?status=active&page=1&limit=1').then(r => r.json()).then(j => setActiveRoutes(j?.meta?.total ?? 0)).catch(() => setActiveRoutes(0))
  }, [routesTick])

  const routeColumns = (reload: () => void): Column<FlightRoute>[] => [
    { key: 'route', header: 'Rute', mobile: 'title', cell: r => <Link href={`${base}/routes/${r.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{r.origin} → {r.destination}</Link> },
    { key: 'status', header: 'Status', cell: r => <Badge tone={r.isActive ? 'ok' : 'neutral'}>{r.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: r => <CatalogActions editHref={`${base}/routes/${r.id}`} url={`/api/v1/admin/products/flight/routes/${r.id}`} subject={`rute ${r.origin} → ${r.destination}`} active={r.isActive} onDone={() => { reload(); setRoutesTick(t => t + 1) }} /> },
  ]

  const scheduleColumns = (reload: () => void): Column<FlightSchedule>[] => [
    { key: 'route', header: 'Rute', mobile: 'title', cell: s => <Link href={`${base}/${s.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{s.route.origin} → {s.route.destination}</Link> },
    { key: 'airline', header: 'Maskapai', hideBelowLg: true, cell: s => <span className="text-[12px] text-admin-muted">{s.airlineName ?? '—'}</span> },
    { key: 'period', header: 'Periode', cell: s => <span className="text-[12px] text-admin-muted">{formatDate(s.departureFrom)} – {formatDate(s.departureTo)}</span> },
    { key: 'price', header: 'Harga', align: 'right', cell: s => <span className="text-[12px] font-semibold tabular-nums text-admin-ink/80">{formatRupiah(s.price)}</span> },
    { key: 'quota', header: 'Kuota', align: 'right', cell: s => <span className="text-[12px] text-admin-muted">{s.bookedSeats + s.pendingSeats}/{s.totalSeats}</span> },
    { key: 'status', header: 'Status', cell: s => <Badge tone={s.isActive ? 'ok' : 'neutral'}>{s.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: s => <CatalogActions editHref={`${base}/${s.id}`} url={`/api/v1/admin/products/flight/schedules/${s.id}`} subject={`jadwal ${s.route.origin} → ${s.route.destination}`} active={s.isActive} onDone={reload} /> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader icon={Plane} title="Tiket Pesawat" description="Kelola rute dan jadwal penerbangan" />

      {/* Rute */}
      <div className="admin-form-panel space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><MapPin className="h-4 w-4" /> Rute</p>
          <Link href={`/${locale}/admin/products/flight/routes/new`} className="admin-btn-sm flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Tambah Rute
          </Link>
        </div>

        <CatalogList<FlightRoute> ns="r" endpoint="/api/v1/admin/products/flight/routes" columns={routeColumns} getRowId={r => r.id} status isActive={r => r.isActive} searchPlaceholder="Cari kota asal / tujuan…" empty="Belum ada rute. Klik Tambah Rute untuk mulai." />
      </div>

      {/* Jadwal */}
      <div className="admin-form-panel space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-admin-ink">Jadwal Penerbangan</p>
          {activeRoutes === 0 ? (
            <span className="admin-btn-sm flex cursor-not-allowed items-center gap-1.5 opacity-50"><Plus className="h-3.5 w-3.5" /> Tambah Jadwal</span>
          ) : (
            <Link href={`/${locale}/admin/products/flight/new`} className="admin-btn-sm flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Tambah Jadwal</Link>
          )}
        </div>

        {activeRoutes === 0 && (
          <p className="text-[11px] text-admin-warning">Tambah rute dulu sebelum bisa buat jadwal.</p>
        )}

        <CatalogList<FlightSchedule> ns="s" endpoint="/api/v1/admin/products/flight/schedules" columns={scheduleColumns} getRowId={s => s.id} status isActive={s => s.isActive} searchPlaceholder="Cari rute…" empty="Belum ada jadwal." />
      </div>
    </div>
  )
}
