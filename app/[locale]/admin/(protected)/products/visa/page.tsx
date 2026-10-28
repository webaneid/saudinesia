'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, KeyRound } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'
import { ProfitCell } from '@/components/admin/pricing/ProfitCell'

type VisaProduct = {
  id: string; name: string; country: string; visaType: string
  price: number; profitIdr: number | null; marginPct: number | null; processDays: number; isActive: boolean
}

export default function VisaPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/visa`
  const columns = (reload: () => void): Column<VisaProduct>[] => [
    { key: 'name', header: 'Nama', mobile: 'title', cell: v => <Link href={`${base}/${v.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{v.name}</Link> },
    { key: 'country', header: 'Negara', cell: v => <span className="text-[12px] text-admin-muted">{v.country || 'Saudi Arabia'}</span> },
    { key: 'type', header: 'Jenis', cell: v => <Badge tone="accent">{v.visaType}</Badge> },
    { key: 'price', header: 'Harga', align: 'right', cell: v => <span className="text-[12px] font-semibold tabular-nums text-admin-ink/80">{formatRupiah(v.price)}</span> },
    { key: 'profit', header: 'Untung', align: 'right', hideBelowLg: true, cell: v => <ProfitCell profitIdr={v.profitIdr} marginPct={v.marginPct} /> },
    { key: 'process', header: 'Proses', align: 'right', cell: v => <span className="text-[12px] text-admin-muted">{v.processDays} hari</span> },
    { key: 'status', header: 'Status', cell: v => <Badge tone={v.isActive ? 'ok' : 'neutral'}>{v.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: v => <CatalogActions editHref={`${base}/${v.id}`} url={`/api/v1/admin/products/visa/${v.id}`} subject={`produk visa ${v.name}`} active={v.isActive} onDone={reload} /> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader
        icon={KeyRound}
        title="Produk Visa"
        description="Kelola jenis dan harga visa — bisa multi-negara"
        actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Produk Visa</Link>}
      />
      <CatalogList<VisaProduct> endpoint="/api/v1/admin/products/visa" columns={columns} getRowId={v => v.id} status isActive={v => v.isActive} searchPlaceholder="Cari nama / negara / jenis…" empty="Belum ada produk visa. Klik Tambah untuk mulai." />
    </div>
  )
}
