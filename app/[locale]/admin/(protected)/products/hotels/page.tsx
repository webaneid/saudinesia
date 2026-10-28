'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { formatDistance } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'

type Hotel = {
  id: string; name: string; city: string; stars: number | null
  distanceToHaramM: number | null; isActive: boolean; _count: { pricePeriods: number }
}

export default function HotelsPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/hotels`
  const columns = (reload: () => void): Column<Hotel>[] => [
    {
      key: 'name', header: 'Nama', mobile: 'title',
      cell: h => (
        <span className="text-[13px] font-medium">
          <Link href={`${base}/${h.id}`} className="hover:text-admin-accent-strong">{h.name}</Link>
          <span className="ml-2 text-[11px] text-admin-gold-strong">{'★'.repeat(h.stars ?? 0)}</span>
        </span>
      ),
    },
    { key: 'city', header: 'Kota', cell: h => <span className="text-[12px] capitalize text-admin-muted">{h.city}</span> },
    {
      key: 'distance', header: 'Jarak', hideBelowLg: true,
      cell: h => <span className="whitespace-nowrap text-[12px] text-admin-muted">{h.distanceToHaramM ? formatDistance(h.distanceToHaramM) : '-'}</span>,
    },
    { key: 'periods', header: 'Periode', cell: h => <span className="whitespace-nowrap text-[12px] text-admin-muted">{h._count.pricePeriods} periode</span> },
    { key: 'status', header: 'Status', cell: h => <Badge tone={h.isActive ? 'ok' : 'neutral'}>{h.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: h => <CatalogActions editHref={`${base}/${h.id}`} url={`/api/v1/admin/products/hotels/${h.id}`} subject={`hotel ${h.name}`} active={h.isActive} onDone={reload} /> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader title="Hotel" actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Hotel</Link>} />
      <CatalogList<Hotel>
        endpoint="/api/v1/admin/products/hotels" columns={columns} getRowId={h => h.id} status isActive={h => h.isActive} searchPlaceholder="Cari nama hotel…"
        filters={[{ param: 'city', label: 'Kota', allLabel: 'Semua kota', options: [{ value: 'makkah', label: 'Makkah' }, { value: 'madinah', label: 'Madinah' }] }]}
        empty='Belum ada hotel. Klik "Tambah Hotel" untuk mulai.'
      />
    </div>
  )
}
