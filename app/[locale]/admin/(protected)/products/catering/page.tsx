'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'

type Catering = { id: string; name: string; boardType: string; menuStyle: string; pricePerPersonRegular: number }

const columns: Column<Catering>[] = [
  { key: 'name', header: 'Nama', mobile: 'title', cell: c => <span className="text-[13px] font-medium">{c.name}</span> },
  { key: 'type', header: 'Tipe', cell: c => <span className="text-[12px] text-admin-muted">{c.boardType} · {c.menuStyle}</span> },
  { key: 'price', header: 'Harga Regular', align: 'right', cell: c => <span className="text-[12px] tabular-nums text-admin-ink/80">{formatRupiah(c.pricePerPersonRegular)}</span> },
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
      <DataTable columns={columns} rows={list} getRowId={c => c.id} loading={loading} empty="Belum ada paket katering." />
    </div>
  )
}
