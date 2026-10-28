'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, Star } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'
import { ProfitCell } from '@/components/admin/pricing/ProfitCell'

type HajiProduct = { id: string; name: string; hajiType: string; year: number; price: number; profitIdr: number | null; marginPct: number | null; totalQuota: number; bookedQuota: number; isActive: boolean }

export default function HajiPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/haji`
  const columns = (reload: () => void): Column<HajiProduct>[] => [
    { key: 'name', header: 'Nama', mobile: 'title', cell: h => <Link href={`${base}/${h.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{h.name}</Link> },
    { key: 'type', header: 'Jenis', cell: h => <Badge tone="warning" className="capitalize">{h.hajiType}</Badge> },
    { key: 'year', header: 'Tahun', cell: h => <span className="text-[12px] text-admin-muted">{h.year}</span> },
    { key: 'price', header: 'Harga', align: 'right', cell: h => h.price > 0
      ? <span className="text-[12px] font-semibold tabular-nums text-admin-ink/80">{formatRupiah(h.price)}</span>
      : <span className="text-[12px] text-admin-muted">Belum diatur</span> },
    { key: 'profit', header: 'Untung', align: 'right', hideBelowLg: true, cell: h => <ProfitCell profitIdr={h.profitIdr} marginPct={h.marginPct} /> },
    {
      key: 'quota', header: 'Kuota', align: 'right',
      cell: h => {
        const sisa = h.totalQuota - h.bookedQuota
        return (
          <span className="text-[12px]">
            <span className={sisa < 5 ? 'font-bold text-admin-danger' : 'font-medium text-admin-ok'}>{sisa}</span>
            <span className="text-admin-muted/70">/{h.totalQuota}</span>
          </span>
        )
      },
    },
    { key: 'status', header: 'Status', cell: h => <Badge tone={h.isActive ? 'ok' : 'neutral'}>{h.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: h => <CatalogActions editHref={`${base}/${h.id}`} url={`/api/v1/admin/products/haji/${h.id}`} subject={`produk haji ${h.name}`} active={h.isActive} onDone={reload} /> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader
        icon={Star}
        title="Produk Haji"
        description="Kelola paket haji Furoda, Khusus, dan Reguler"
        actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Produk Haji</Link>}
      />
      <CatalogList<HajiProduct>
        endpoint="/api/v1/admin/products/haji" columns={columns} getRowId={h => h.id} status isActive={h => h.isActive} searchPlaceholder="Cari nama produk…"
        filters={[{ param: 'type', label: 'Jenis', allLabel: 'Semua jenis', options: [{ value: 'furoda', label: 'Furoda' }, { value: 'khusus', label: 'Khusus' }, { value: 'reguler', label: 'Reguler' }] }]}
        empty="Belum ada produk haji."
      />
    </div>
  )
}
