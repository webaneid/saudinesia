'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Plus, Bus, Route } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'

type Vehicle = { id: string; name: string; vehicleType: string; capacity: number; fleetCount: number; isActive: boolean }
type Trip    = { id: string; name: string; category: string | null; origin: string; destination: string; isActive: boolean; pricing: { id: string }[] }

export default function TransportPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/transport`
  // Tab memisahkan DUA entitas (bukan menyaring data); tiap tabel punya halaman/filter sendiri (awalan param v / t).
  const [tab, setTab] = useState<'vehicles' | 'trips'>('vehicles')

  const vehicleColumns = (reload: () => void): Column<Vehicle>[] => [
    { key: 'name', header: 'Kendaraan', mobile: 'title', cell: v => <Link href={`${base}/vehicles/${v.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{v.name}</Link> },
    { key: 'type', header: 'Tipe', cell: v => <Badge tone="accent" className="capitalize">{v.vehicleType}</Badge> },
    { key: 'capacity', header: 'Kapasitas', align: 'right', cell: v => <span className="text-[13px] text-admin-ink/80">{v.capacity} org</span> },
    { key: 'fleet', header: 'Armada', align: 'right', cell: v => <span className="text-[13px] text-admin-muted">{v.fleetCount} unit</span> },
    { key: 'status', header: 'Status', cell: v => <Badge tone={v.isActive ? 'ok' : 'neutral'}>{v.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: v => <CatalogActions editHref={`${base}/vehicles/${v.id}`} url={`/api/v1/admin/products/transport/vehicles/${v.id}`} subject={`kendaraan ${v.name}`} active={v.isActive} onDone={reload} /> },
  ]

  const tripColumns = (reload: () => void): Column<Trip>[] => [
    { key: 'name', header: 'Nama Trip', mobile: 'title', cell: t => <Link href={`${base}/trips/${t.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{t.name}</Link> },
    {
      key: 'category', header: 'Kategori',
      cell: t => t.category
        ? <Badge tone="accent" className="capitalize">{t.category.replace('_', ' ')}</Badge>
        : <span className="text-[12px] text-admin-muted/50">—</span>,
    },
    { key: 'vehicles', header: 'Kendaraan', align: 'right', cell: t => <span className="text-[13px] text-admin-ink/80">{t.pricing.length} kendaraan</span> },
    { key: 'route', header: 'Rute', cell: t => <span className="text-[12px] text-admin-muted">{t.origin} → {t.destination}</span> },
    { key: 'status', header: 'Status', cell: t => <Badge tone={t.isActive ? 'ok' : 'neutral'}>{t.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: t => <CatalogActions editHref={`${base}/trips/${t.id}`} url={`/api/v1/admin/products/transport/trips/${t.id}`} subject={`trip ${t.name}`} active={t.isActive} onDone={reload} /> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transport"
        actions={
          <Link href={`${base}/${tab === 'vehicles' ? 'vehicles' : 'trips'}/new`} className="admin-btn">
            <Plus className="h-4 w-4" />
            {tab === 'vehicles' ? 'Tambah Kendaraan' : 'Tambah Trip'}
          </Link>
        }
      />

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

      {tab === 'vehicles' && (
        <CatalogList<Vehicle> key="vehicles" ns="v" endpoint="/api/v1/admin/products/transport/vehicles" columns={vehicleColumns} getRowId={v => v.id} status isActive={v => v.isActive} searchPlaceholder="Cari nama kendaraan…" empty="Belum ada kendaraan." />
      )}
      {tab === 'trips' && (
        <CatalogList<Trip> key="trips" ns="t" endpoint="/api/v1/admin/products/transport/trips" columns={tripColumns} getRowId={t => t.id} status isActive={t => t.isActive} searchPlaceholder="Cari nama / rute trip…" empty="Belum ada trip." />
      )}
    </div>
  )
}
