'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Pencil, Plus, Star } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'
import { ProfitCell } from '@/components/admin/pricing/ProfitCell'

type HajiProduct = { id: string; name: string; hajiType: string; year: number; price: number; profitIdr: number | null; marginPct: number | null; totalQuota: number; bookedQuota: number; isActive: boolean }

export default function HajiPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }
  const [list,   setList]   = useState<HajiProduct[]>([])
  const [loading, setLoading] = useState(true)

  async function load() { const r = await fetch('/api/v1/admin/products/haji'); const j = await r.json(); setList(j.data ?? []); setLoading(false) }
  useEffect(() => { load() }, [])

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/v1/admin/products/haji/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !isActive }) })
    await load()
  }

  const columns: Column<HajiProduct>[] = [
    { key: 'name', header: 'Nama', mobile: 'title', cell: h => (
      <button onClick={() => router.push(`/${locale}/admin/products/haji/${h.id}`)} className="text-left text-[13px] font-medium hover:text-admin-accent-strong">{h.name}</button>
    ) },
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
    {
      key: 'actions', header: '', align: 'right',
      cell: h => (
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => router.push(`/${locale}/admin/products/haji/${h.id}`)}
            className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
            <Pencil className="h-3.5 w-3.5" /> Kelola
          </button>
          <button onClick={() => toggleActive(h.id, h.isActive)} className="text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
            {h.isActive ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Star}
        title="Produk Haji"
        description="Kelola paket haji Furoda, Khusus, dan Reguler"
        actions={<Link href={`/${locale}/admin/products/haji/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Produk Haji</Link>}
      />

      <DataTable columns={columns} rows={list} getRowId={h => h.id} loading={loading} empty="Belum ada produk haji." rowClassName={h => (h.isActive ? undefined : 'opacity-50')} />
    </div>
  )
}
