'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Bus, Route, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type Vehicle = { id: string; name: string; vehicleType: string; capacity: number; fleetCount: number; isActive: boolean }
type Trip    = { id: string; name: string; category: string | null; origin: string; destination: string; isActive: boolean; pricing: { id: string }[] }

export default function TransportPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'vehicles' | 'trips'>('vehicles')
  const [locale, setLocale] = useState('id')

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [trips,    setTrips]    = useState<Trip[]>([])

  const [showVehicle, setShowVehicle] = useState(false)
  const [savingV,     setSavingV]     = useState(false)
  const [vForm, setVForm] = useState({ name: '', vehicleType: 'bus', capacity: 49, fleetCount: 1 })

  const [showTrip, setShowTrip] = useState(false)
  const [savingT,  setSavingT]  = useState(false)
  const [tForm, setTForm] = useState({ name: '', category: '', origin: '', destination: '' })

  async function loadVehicles() {
    const r = await fetch('/api/v1/admin/products/transport/vehicles')
    const j = await r.json()
    setVehicles(j.data ?? [])
  }
  async function loadTrips() {
    const r = await fetch('/api/v1/admin/products/transport/trips')
    const j = await r.json()
    setTrips(j.data ?? [])
  }

  useEffect(() => {
    const parts = window.location.pathname.split('/')
    if (parts[1]) setLocale(parts[1])
    loadVehicles()
    loadTrips()
  }, [])

  function setV(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setVForm(p => ({ ...p, [k]: e.target.value }))
  }
  function setT(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setTForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleSaveVehicle() {
    setSavingV(true)
    const r = await fetch('/api/v1/admin/products/transport/vehicles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...vForm, capacity: +vForm.capacity, fleetCount: +vForm.fleetCount }),
    })
    const j = await r.json()
    setSavingV(false)
    if (j.data?.id) router.push(`/${locale}/admin/products/transport/vehicles/${j.data.id}`)
  }

  async function handleSaveTrip() {
    setSavingT(true)
    const r = await fetch('/api/v1/admin/products/transport/trips', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...tForm,
        category: tForm.category || null,
      }),
    })
    const j = await r.json()
    setSavingT(false)
    if (j.data?.id) router.push(`/${locale}/admin/products/transport/trips/${j.data.id}`)
  }

  const TYPES = ['bus', 'coaster', 'hiace', 'staria', 'gmc', 'innova', 'sedan']
  const CATS  = ['airport', 'intercity', 'city_tour', 'shuttle', 'other']

  const vehicleColumns: Column<Vehicle>[] = [
    { key: 'name', header: 'Kendaraan', mobile: 'title', cell: v => <span className="text-[13px] font-medium">{v.name}</span> },
    { key: 'type', header: 'Tipe', cell: v => <Badge tone="accent" className="capitalize">{v.vehicleType}</Badge> },
    { key: 'capacity', header: 'Kapasitas', align: 'right', cell: v => <span className="text-[13px] text-admin-ink/80">{v.capacity} org</span> },
    { key: 'fleet', header: 'Armada', align: 'right', cell: v => <span className="text-[13px] text-admin-muted">{v.fleetCount} unit</span> },
    { key: 'status', header: 'Status', cell: v => <Badge tone={v.isActive ? 'ok' : 'neutral'}>{v.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: v => (
        <button onClick={() => router.push(`/${locale}/admin/products/transport/vehicles/${v.id}`)}
          className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      ),
    },
  ]

  const tripColumns: Column<Trip>[] = [
    { key: 'name', header: 'Nama Trip', mobile: 'title', cell: t => <span className="text-[13px] font-medium">{t.name}</span> },
    {
      key: 'category', header: 'Kategori',
      cell: t => t.category
        ? <Badge tone="accent" className="capitalize">{t.category.replace('_', ' ')}</Badge>
        : <span className="text-[12px] text-admin-muted/50">—</span>,
    },
    { key: 'vehicles', header: 'Kendaraan', align: 'right', cell: t => <span className="text-[13px] text-admin-ink/80">{t.pricing.length} kendaraan</span> },
    { key: 'route', header: 'Rute', cell: t => <span className="text-[12px] text-admin-muted">{t.origin} → {t.destination}</span> },
    { key: 'status', header: 'Status', cell: t => <Badge tone={t.isActive ? 'ok' : 'neutral'}>{t.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: t => (
        <button onClick={() => router.push(`/${locale}/admin/products/transport/trips/${t.id}`)}
          className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
          <Pencil className="h-3.5 w-3.5" /> Edit & Harga
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transport"
        actions={
          <button onClick={() => tab === 'vehicles' ? setShowVehicle(s => !s) : setShowTrip(s => !s)} className="admin-btn">
            <Plus className="h-4 w-4" />
            {tab === 'vehicles' ? 'Tambah Kendaraan' : 'Tambah Trip'}
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-admin-line">
        {([['vehicles', 'Kendaraan', Bus], ['trips', 'Trip & Harga', Route]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key ? 'border-admin-accent text-admin-accent' : 'border-transparent text-admin-muted hover:text-admin-ink'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* ── Tab Kendaraan ── */}
      {tab === 'vehicles' && (
        <>
          {showVehicle && (
            <div className="admin-form-panel space-y-3">
              <p className="text-sm font-semibold text-admin-ink">Kendaraan Baru</p>
              <p className="text-[11px] text-admin-muted/70">
                Harga tidak diset di sini — diatur di halaman Trip per kombinasi trip+kendaraan.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-admin-muted mb-1">Nama</p>
                  <input className="admin-inp" value={vForm.name} onChange={setV('name')} placeholder="Bus Pariwisata 49" />
                </div>
                <div>
                  <p className="text-xs text-admin-muted mb-1">Tipe</p>
                  <select className="admin-select" value={vForm.vehicleType} onChange={setV('vehicleType')}>
                    {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-admin-muted mb-1">Kapasitas (orang)</p>
                  <input type="number" min={1} className="admin-inp" value={vForm.capacity} onChange={setV('capacity')} />
                </div>
                <div>
                  <p className="text-xs text-admin-muted mb-1">Jumlah Armada (unit)</p>
                  <input type="number" min={1} className="admin-inp" value={vForm.fleetCount} onChange={setV('fleetCount')} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveVehicle} disabled={savingV || !vForm.name} className="admin-btn-sm disabled:opacity-50">
                  {savingV ? 'Menyimpan...' : 'Simpan & Edit →'}
                </button>
                <button onClick={() => setShowVehicle(false)} className="admin-btn-ghost text-sm">Batal</button>
              </div>
            </div>
          )}

          <DataTable columns={vehicleColumns} rows={vehicles} getRowId={v => v.id} empty="Belum ada kendaraan." rowClassName={v => (v.isActive ? undefined : 'opacity-50')} />
        </>
      )}

      {/* ── Tab Trip & Harga ── */}
      {tab === 'trips' && (
        <>
          {showTrip && (
            <div className="admin-form-panel space-y-3">
              <p className="text-sm font-semibold text-admin-ink">Trip Baru</p>
              <p className="text-[11px] text-admin-muted/70">
                Setelah disimpan, kamu akan diarahkan ke halaman edit untuk mengatur harga per kendaraan.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <p className="text-xs text-admin-muted mb-1">Nama Trip</p>
                  <input className="admin-inp" value={tForm.name} onChange={setT('name')} placeholder="Airport Transfer — Bandara ke Hotel" />
                </div>
                <div>
                  <p className="text-xs text-admin-muted mb-1">Kategori (opsional)</p>
                  <input className="admin-inp" value={tForm.category} onChange={setT('category')}
                    list="cat-list" placeholder="airport / intercity / city_tour" />
                  <datalist id="cat-list">{CATS.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <p className="text-xs text-admin-muted mb-1">Origin (titik jemput)</p>
                  <input className="admin-inp" value={tForm.origin} onChange={setT('origin')} placeholder="Bandara King Abdulaziz Jeddah" />
                </div>
                <div>
                  <p className="text-xs text-admin-muted mb-1">Destination (titik tujuan)</p>
                  <input className="admin-inp" value={tForm.destination} onChange={setT('destination')} placeholder="Hotel Makkah/Madinah" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveTrip} disabled={savingT || !tForm.name || !tForm.origin || !tForm.destination} className="admin-btn-sm disabled:opacity-50">
                  {savingT ? 'Menyimpan...' : 'Simpan & Atur Harga →'}
                </button>
                <button onClick={() => setShowTrip(false)} className="admin-btn-ghost text-sm">Batal</button>
              </div>
            </div>
          )}

          <DataTable columns={tripColumns} rows={trips} getRowId={t => t.id} empty="Belum ada trip." rowClassName={t => (t.isActive ? undefined : 'opacity-50')} />
        </>
      )}
    </div>
  )
}
