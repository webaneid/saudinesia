'use client'

import Link from 'next/link'
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
          <Link href={`/${locale}/admin/products/transport/${tab === 'vehicles' ? 'vehicles' : 'trips'}/new`} className="admin-btn">
            <Plus className="h-4 w-4" />
            {tab === 'vehicles' ? 'Tambah Kendaraan' : 'Tambah Trip'}
          </Link>
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
          <DataTable columns={vehicleColumns} rows={vehicles} getRowId={v => v.id} empty="Belum ada kendaraan." rowClassName={v => (v.isActive ? undefined : 'opacity-50')} />
        </>
      )}

      {/* ── Tab Trip & Harga ── */}
      {tab === 'trips' && (
        <>
          <DataTable columns={tripColumns} rows={trips} getRowId={t => t.id} empty="Belum ada trip." rowClassName={t => (t.isActive ? undefined : 'opacity-50')} />
        </>
      )}
    </div>
  )
}
