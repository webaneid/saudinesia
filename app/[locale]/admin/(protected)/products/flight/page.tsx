'use client'

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

  const [showRouteForm, setShowRouteForm] = useState(false)
  const [savingRoute, setSavingRoute] = useState(false)
  const [routeForm, setRouteForm] = useState({ origin: '', destination: '' })

  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({ routeId: '', departureFrom: '', departureTo: '', totalSeats: '0' })

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

  async function handleSaveRoute() {
    setSavingRoute(true)
    await fetch('/api/v1/admin/products/flight/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routeForm),
    })
    await loadRoutes()
    setSavingRoute(false); setShowRouteForm(false)
    setRouteForm({ origin: '', destination: '' })
  }

  async function handleSaveSchedule() {
    setSavingSchedule(true)
    const r = await fetch('/api/v1/admin/products/flight/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...scheduleForm, totalSeats: +scheduleForm.totalSeats }),
    })
    const j = await r.json()
    setSavingSchedule(false)
    if (j.data?.id) {
      router.push(`/${locale}/admin/products/flight/${j.data.id}`)
    }
  }

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
          <button onClick={() => setShowRouteForm(!showRouteForm)} className="admin-btn-sm flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Tambah Rute
          </button>
        </div>

        {showRouteForm && (
          <div className="border border-admin-line rounded-xl p-4 space-y-3 bg-admin-spot/30">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-admin-muted mb-1">Asal</p>
                <input className="admin-inp" value={routeForm.origin} onChange={e => setRouteForm(f => ({ ...f, origin: e.target.value }))} placeholder="Cengkareng (CGK)" />
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">Tujuan</p>
                <input className="admin-inp" value={routeForm.destination} onChange={e => setRouteForm(f => ({ ...f, destination: e.target.value }))} placeholder="Madinah (MED)" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveRoute} disabled={savingRoute || !routeForm.origin || !routeForm.destination} className="admin-btn-sm disabled:opacity-50">
                {savingRoute ? '...' : 'Simpan Rute'}
              </button>
              <button onClick={() => setShowRouteForm(false)} className="admin-btn-ghost text-sm">Batal</button>
            </div>
          </div>
        )}

        {activeRoutes.length === 0 && !showRouteForm && (
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
          <button onClick={() => setShowScheduleForm(!showScheduleForm)} className="admin-btn-sm flex items-center gap-1.5" disabled={activeRoutes.length === 0}>
            <Plus className="h-3.5 w-3.5" /> Tambah Jadwal
          </button>
        </div>

        {activeRoutes.length === 0 && (
          <p className="text-[11px] text-admin-warning">Tambah rute dulu sebelum bisa buat jadwal.</p>
        )}

        {showScheduleForm && (
          <div className="border border-admin-line rounded-xl p-4 space-y-3 bg-admin-spot/30">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <p className="text-xs text-admin-muted mb-1">Rute</p>
                <select className="admin-inp" value={scheduleForm.routeId} onChange={e => setScheduleForm(f => ({ ...f, routeId: e.target.value }))}>
                  <option value="">Pilih rute…</option>
                  {activeRoutes.map(r => <option key={r.id} value={r.id}>{r.origin} → {r.destination}</option>)}
                </select>
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">Periode Mulai</p>
                <input type="date" className="admin-inp" value={scheduleForm.departureFrom} onChange={e => setScheduleForm(f => ({ ...f, departureFrom: e.target.value }))} />
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">Periode Akhir</p>
                <input type="date" className="admin-inp" value={scheduleForm.departureTo} onChange={e => setScheduleForm(f => ({ ...f, departureTo: e.target.value }))} />
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">Total Kursi</p>
                <input type="number" className="admin-inp" value={scheduleForm.totalSeats} onChange={e => setScheduleForm(f => ({ ...f, totalSeats: e.target.value }))} />
              </div>
            </div>
            <p className="text-[11px] text-admin-muted/70">Harga & maskapai diatur di halaman edit setelah jadwal dibuat — harga terhitung otomatis begitu komponen HPP diisi.</p>
            <div className="flex gap-2">
              <button
                onClick={handleSaveSchedule}
                disabled={savingSchedule || !scheduleForm.routeId || !scheduleForm.departureFrom || !scheduleForm.departureTo}
                className="admin-btn-sm disabled:opacity-50"
              >
                {savingSchedule ? 'Menyimpan...' : 'Simpan & Lanjut →'}
              </button>
              <button onClick={() => setShowScheduleForm(false)} className="admin-btn-ghost text-sm">Batal</button>
            </div>
          </div>
        )}

        {schedules.length === 0 && !showScheduleForm && (
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
