'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Pencil, Package } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'
import { ProfitCell } from '@/components/admin/pricing/ProfitCell'

type Pkg = { id: string; name: string; price: number; profitIdr: number | null; marginPct: number | null; isFeatured: boolean; isActive: boolean }

export default function PackagesPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }

  const [list, setList] = useState<Pkg[]>([])
  const [loading, setLoading] = useState(true)

  async function load() { const r = await fetch('/api/v1/admin/products/packages'); const j = await r.json(); setList(j.data ?? []); setLoading(false) }
  useEffect(() => { load() }, [])

  const columns: Column<Pkg>[] = [
    {
      key: 'name', header: 'Nama Paket', mobile: 'title',
      cell: p => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{p.name}</span>
          {p.isFeatured && <Badge tone="accent">Featured</Badge>}
        </div>
      ),
    },
    { key: 'price', header: 'Harga Jual Paket', align: 'right', cell: p => <span className="text-[12px] font-semibold tabular-nums text-admin-ink/80">{formatRupiah(p.price)}</span> },
    { key: 'profit', header: 'Untung', align: 'right', hideBelowLg: true, cell: p => <ProfitCell profitIdr={p.profitIdr} marginPct={p.marginPct} /> },
    { key: 'status', header: 'Status', cell: p => <Badge tone={p.isActive ? 'ok' : 'neutral'}>{p.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: p => (
        <button onClick={() => router.push(`/${locale}/admin/products/packages/${p.id}`)}
          className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
          <Pencil className="h-3.5 w-3.5" /> Kelola
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Package}
        title="Paket Umroh"
        description='Isi info dasar dulu — hotel, kendaraan, muthowif, visa, tiket pesawat, katering, dan komponen biaya dikonfigurasi setelah paket dibuat (klik "Kelola").'
        actions={<Link href={`/${locale}/admin/products/packages/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Paket</Link>}
      />

      <DataTable columns={columns} rows={list} getRowId={p => p.id} loading={loading} empty="Belum ada paket umroh." rowClassName={p => (p.isActive ? undefined : 'opacity-50')} />
    </div>
  )
}
