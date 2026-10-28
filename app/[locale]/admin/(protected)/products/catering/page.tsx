'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'

type Catering = { id: string; name: string; boardType: string; menuStyle: string; pricePerPersonRegular: number; isActive: boolean }

export default function CateringPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/catering`
  const columns = (reload: () => void): Column<Catering>[] => [
    { key: 'name', header: 'Nama', mobile: 'title', cell: c => <Link href={`${base}/${c.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{c.name}</Link> },
    { key: 'type', header: 'Tipe', cell: c => <span className="text-[12px] text-admin-muted">{c.boardType} · {c.menuStyle}</span> },
    { key: 'price', header: 'Harga Regular', align: 'right', cell: c => <span className="text-[12px] tabular-nums text-admin-ink/80">{formatRupiah(c.pricePerPersonRegular)}</span> },
    { key: 'status', header: 'Status', cell: c => <Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: c => <CatalogActions editHref={`${base}/${c.id}`} url={`/api/v1/admin/products/catering/${c.id}`} subject={`paket katering ${c.name}`} active={c.isActive} onDone={reload} /> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader title="Paket Katering" actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>} />
      <CatalogList<Catering> endpoint="/api/v1/admin/products/catering" columns={columns} getRowId={c => c.id} status isActive={c => c.isActive} searchPlaceholder="Cari nama paket…" empty="Belum ada paket katering." />
    </div>
  )
}
