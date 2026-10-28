'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, MapPin } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'

type TourismSite = { id: string; name: string; city: string | null; isActive: boolean }

export default function TourismSitesPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/tourism-sites`
  const columns = (reload: () => void): Column<TourismSite>[] => [
    { key: 'name', header: 'Nama', mobile: 'title', cell: s => <Link href={`${base}/${s.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{s.name}</Link> },
    { key: 'city', header: 'Kota', cell: s => <span className="text-[12px] capitalize text-admin-muted">{s.city}</span> },
    { key: 'status', header: 'Status', cell: s => <Badge tone={s.isActive ? 'ok' : 'neutral'}>{s.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: s => <CatalogActions editHref={`${base}/${s.id}`} url={`/api/v1/admin/products/tourism-sites/${s.id}`} subject={`situs ${s.name}`} active={s.isActive} onDone={reload} /> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader
        icon={MapPin}
        title="Situs Wisata"
        description="Master data tempat wisata — dipakai berulang di berbagai Paket Ziarah."
        actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>}
      />
      <CatalogList<TourismSite> endpoint="/api/v1/admin/products/tourism-sites" columns={columns} getRowId={s => s.id} status isActive={s => s.isActive} searchPlaceholder="Cari nama / kota…" empty="Belum ada situs wisata." />
    </div>
  )
}
