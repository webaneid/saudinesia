'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type Catering = { id: string; name: string; boardType: string; menuStyle: string; pricePerPersonRegular: number; isActive: boolean }

const columns = (locale: string): Column<Catering>[] => [
  { key: 'name', header: 'Nama', mobile: 'title', cell: c => <Link href={`/${locale}/admin/products/catering/${c.id}`} className="text-[13px] font-medium hover:text-admin-accent-strong">{c.name}</Link> },
  { key: 'type', header: 'Tipe', cell: c => <span className="text-[12px] text-admin-muted">{c.boardType} · {c.menuStyle}</span> },
  { key: 'price', header: 'Harga Regular', align: 'right', cell: c => <span className="text-[12px] tabular-nums text-admin-ink/80">{formatRupiah(c.pricePerPersonRegular)}</span> },
  { key: 'status', header: 'Status', cell: c => <Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
  { key: 'actions', header: '', align: 'right', cell: c => <Link href={`/${locale}/admin/products/catering/${c.id}`} className="inline-flex items-center gap-1 text-[12px] text-admin-muted hover:text-admin-ink"><Pencil className="h-3.5 w-3.5" /> Kelola</Link> },
]

export default function CateringPage() {
  const [list,   setList]   = useState<Catering[]>([])
  const { locale } = useParams() as { locale: string }
  const [loading, setLoading] = useState(true)

  async function load() { const r = await fetch('/api/v1/admin/products/catering'); const j = await r.json(); setList(j.data ?? []); setLoading(false) }
  useEffect(() => { load() }, [])

  return (
    <div className="space-y-5">
      <PageHeader title="Paket Katering" actions={<Link href={`/${locale}/admin/products/catering/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>} />
      <DataTable columns={columns(locale)} rows={list} getRowId={c => c.id} loading={loading} empty="Belum ada paket katering." rowClassName={c => (c.isActive ? undefined : 'opacity-50')} />
    </div>
  )
}
