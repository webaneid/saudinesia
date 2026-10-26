'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { Plane, Plus, Pencil, MapPin, Globe } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
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
  const router = useRouter()
  const [locale, setLocale] = useState('id')
  const [routes, setRoutes] = useState<FlightRoute[]>([])
  const [schedules, setSchedules] = useState<FlightSchedule[]>([])

  async function loadRoutes() {
    const r = await fetch('/api/v1/admin/products/flight/routes')
    const j = await r.json()
    setRoutes(j.data ?? [])
  }
  async function loadSchedules() {
    const r = await fetch('/api/v1/admin/products/flight/schedules')
    const j = await r.json()
    setSchedules(j.data ?? [])
  }

  useEffect(() => {
    loadRoutes()
    loadSchedules()
    const parts = window.location.pathname.split('/')
    if (parts[1]) setLocale(parts[1])
  }, [])

  const activeRoutes = routes.filter(r => r.isActive)

  const scheduleColumns: Column<FlightSchedule>[] = [
    { key: 'route', header: 'Rute', mobile: 'title', cell: s => <span className="text-[13px] font-medium">{s.route.origin} → {s.route.destination}</span> },
    { key: 'airline', header: 'Maskapai', cell: s => <span className="text-[12px] text-admin-muted">{s.airlineName ?? '—'}</span> },
    { key: 'period', header: 'Periode', cell: s => <span className="text-[12px] text-admin-muted">{formatDate(s.departureFrom)} – {formatDate(s.departureTo)}</span> },
    { key: 'price', header: 'Harga', align: 'right', cell: s => <span className="text-[12px] font-semibold tabular-nums text-admin-ink/80">{formatRupiah(s.price)}</span> },
    { key: 'quota', header: 'Kuota', align: 'right', cell: s => <span className="text-[12px] text-admin-muted">{s.bookedSeats + s.pendingSeats}/{s.totalSeats}</span> },
    { key: 'status', header: 'Status', cell: s => <Badge tone={s.isActive ? 'ok' : 'neutral'}>{s.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: s => (
        <button
          onClick={() => router.push(`/${locale}/admin/products/flight/${s.id}`)}
          className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      ),
    },
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

        {activeRoutes.length === 0 && (
          <p className="text-[13px] text-admin-muted/70 py-3 text-center border border-dashed border-admin-line rounded-xl">
            Belum ada rute. Klik Tambah Rute untuk mulai.
          </p>
        )}

        {activeRoutes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeRoutes.map(r => (
              <span key={r.id} className="admin-badge-blue flex items-center gap-1">
                <Globe className="h-3 w-3" /> {r.origin} → {r.destination}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Jadwal */}
      <div className="admin-form-panel space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-admin-ink">Jadwal Penerbangan</p>
          {activeRoutes.length === 0 ? (
            <span className="admin-btn-sm flex cursor-not-allowed items-center gap-1.5 opacity-50"><Plus className="h-3.5 w-3.5" /> Tambah Jadwal</span>
          ) : (
            <Link href={`/${locale}/admin/products/flight/new`} className="admin-btn-sm flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Tambah Jadwal</Link>
          )}
        </div>

        {activeRoutes.length === 0 && (
          <p className="text-[11px] text-admin-warning">Tambah rute dulu sebelum bisa buat jadwal.</p>
        )}

        {schedules.length === 0 && (
          <p className="text-[13px] text-admin-muted/70 py-3 text-center border border-dashed border-admin-line rounded-xl">
            Belum ada jadwal.
          </p>
        )}

        {schedules.length > 0 && (
          <DataTable columns={scheduleColumns} rows={schedules} getRowId={s => s.id} rowClassName={s => (s.isActive ? undefined : 'opacity-50')} />
        )}
      </div>
    </div>
  )
}
