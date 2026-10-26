'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Pencil, MapPin } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type TourismSite = { id: string; name: string; city: string | null; isActive: boolean }

export default function TourismSitesPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }

  const [list, setList] = useState<TourismSite[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const r = await fetch('/api/v1/admin/products/tourism-sites')
    const j = await r.json()
    setList(j.data ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const columns: Column<TourismSite>[] = [
    { key: 'name', header: 'Nama', mobile: 'title', cell: s => <span className="text-[13px] font-medium">{s.name}</span> },
    { key: 'city', header: 'Kota', cell: s => <span className="text-[12px] capitalize text-admin-muted">{s.city}</span> },
    { key: 'status', header: 'Status', cell: s => <Badge tone={s.isActive ? 'ok' : 'neutral'}>{s.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: s => (
        <button onClick={() => router.push(`/${locale}/admin/products/tourism-sites/${s.id}`)}
          className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MapPin}
        title="Situs Wisata"
        description="Master data tempat wisata — dipakai berulang di berbagai Paket Ziarah."
        actions={<Link href={`/${locale}/admin/products/tourism-sites/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>}
      />

      <DataTable columns={columns} rows={list} getRowId={s => s.id} loading={loading} empty="Belum ada situs wisata." rowClassName={s => (s.isActive ? undefined : 'opacity-50')} />
    </div>
  )
}
