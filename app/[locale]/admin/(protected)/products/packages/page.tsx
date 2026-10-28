'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, Package } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'
import { ProfitCell } from '@/components/admin/pricing/ProfitCell'

type Pkg = { id: string; name: string; price: number; profitIdr: number | null; marginPct: number | null; isFeatured: boolean; isActive: boolean }

export default function PackagesPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/packages`
  const columns = (reload: () => void): Column<Pkg>[] => [
    {
      key: 'name', header: 'Nama Paket', mobile: 'title',
      cell: p => (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${base}/${p.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{p.name}</Link>
          {p.isFeatured && <Badge tone="accent">Featured</Badge>}
        </div>
      ),
    },
    { key: 'price', header: 'Harga Jual Paket', align: 'right', cell: p => <span className="text-[12px] font-semibold tabular-nums text-admin-ink/80">{formatRupiah(p.price)}</span> },
    { key: 'profit', header: 'Untung', align: 'right', hideBelowLg: true, cell: p => <ProfitCell profitIdr={p.profitIdr} marginPct={p.marginPct} /> },
    { key: 'status', header: 'Status', cell: p => <Badge tone={p.isActive ? 'ok' : 'neutral'}>{p.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: p => <CatalogActions editHref={`${base}/${p.id}`} url={`/api/v1/admin/products/packages/${p.id}`} subject={`paket ${p.name}`} active={p.isActive} onDone={reload} /> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader
        icon={Package}
        title="Paket Umroh"
        description='Isi info dasar dulu — hotel, kendaraan, muthowif, visa, tiket pesawat, katering, dan komponen biaya dikonfigurasi setelah paket dibuat (klik "Edit").'
        actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Paket</Link>}
      />
      <CatalogList<Pkg> endpoint="/api/v1/admin/products/packages" columns={columns} getRowId={p => p.id} status isActive={p => p.isActive} searchPlaceholder="Cari nama paket…" empty="Belum ada paket umroh." />
    </div>
  )
}
