'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, Landmark } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'
import { ProfitCell } from '@/components/admin/pricing/ProfitCell'

type TourPackage = {
  id: string; name: string; price: string | number; profitIdr: number | null; marginPct: number | null; isActive: boolean
  transportMode: 'included' | 'user_choice' | 'none'
  transportTrip: { name: string; origin: string; destination: string } | null
  includedTransportPricing: { vehicle: { name: string } } | null
  _count: { sites: number }
}

function formatPrice(p: string | number) {
  const n = Number(p)
  return n > 0 ? `Rp ${n.toLocaleString('id-ID')}` : '—'
}

function transportLabel(p: TourPackage) {
  if (p.transportMode === 'included' && p.includedTransportPricing) return `${p.includedTransportPricing.vehicle.name} (included)`
  if (p.transportMode === 'user_choice' && p.transportTrip) return `${p.transportTrip.origin} → ${p.transportTrip.destination} (user choice)`
  return '— tanpa kendaraan —'
}

export default function TourPackagesPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/tour-packages`
  const columns = (reload: () => void): Column<TourPackage>[] => [
    { key: 'name', header: 'Nama Paket', mobile: 'title', cell: p => <Link href={`${base}/${p.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{p.name}</Link> },
    { key: 'transport', header: 'Kendaraan', cell: p => <span className="text-[12px] text-admin-muted">{transportLabel(p)}</span> },
    { key: 'sites', header: 'Situs', cell: p => <span className="text-[12px] text-admin-muted">{p._count.sites} situs</span> },
    { key: 'price', header: 'Harga Jual Paket', cell: p => <span className="text-[12px] font-medium text-admin-ink/80">{formatPrice(p.price)}</span> },
    { key: 'profit', header: 'Untung', align: 'right', hideBelowLg: true, cell: p => <ProfitCell profitIdr={p.profitIdr} marginPct={p.marginPct} /> },
    { key: 'status', header: 'Status', cell: p => <Badge tone={p.isActive ? 'ok' : 'neutral'}>{p.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: p => <CatalogActions editHref={`${base}/${p.id}`} url={`/api/v1/admin/products/tour-packages/${p.id}`} subject={`paket ziarah ${p.name}`} active={p.isActive} onDone={reload} /> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader
        icon={Landmark}
        title="Paket Ziarah"
        description="Paket wisata ziarah — kendaraan & hotel dikonfigurasi di halaman Edit setelah paket dibuat."
        actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>}
      />
      <CatalogList<TourPackage> endpoint="/api/v1/admin/products/tour-packages" columns={columns} getRowId={p => p.id} status isActive={p => p.isActive} searchPlaceholder="Cari nama paket…" empty="Belum ada paket ziarah." />
    </div>
  )
}
