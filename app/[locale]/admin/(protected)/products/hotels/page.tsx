'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Images } from 'lucide-react'
import { formatDistance } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type Hotel = {
  id: string; name: string; city: string; stars: number | null
  distanceToHaramM: number | null; isActive: boolean; _count: { pricePeriods: number }
}

export default function HotelsPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }
  const [hotels,   setHotels]   = useState<Hotel[]>([])
  const [loading,  setLoading]  = useState(true)

  async function load() {
    const r = await fetch('/api/v1/admin/products/hotels')
    const j = await r.json()
    setHotels(j.data ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/v1/admin/products/hotels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    await load()
  }

  const columns: Column<Hotel>[] = [
    {
      key: 'name', header: 'Nama', mobile: 'title',
      cell: h => (
        <span className="text-[13px] font-medium">
          {h.name}
          <span className="ml-2 text-[11px] text-admin-gold-strong">{'★'.repeat(h.stars ?? 0)}</span>
        </span>
      ),
    },
    { key: 'city', header: 'Kota', cell: h => <span className="text-[12px] capitalize text-admin-muted">{h.city}</span> },
    {
      key: 'distance', header: 'Jarak', hideBelowLg: true,
      cell: h => <span className="whitespace-nowrap text-[12px] text-admin-muted">{h.distanceToHaramM ? formatDistance(h.distanceToHaramM) : '-'}</span>,
    },
    { key: 'periods', header: 'Periode', cell: h => <span className="whitespace-nowrap text-[12px] text-admin-muted">{h._count.pricePeriods} periode</span> },
    { key: 'status', header: 'Status', cell: h => <Badge tone={h.isActive ? 'ok' : 'neutral'}>{h.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '',
      cell: h => (
        <div className="flex items-center gap-2">
          <a
            href={`/${locale}/admin/products/hotels/${h.id}`}
            className="flex h-7 items-center gap-1 rounded-lg border border-admin-line px-2.5 text-[11px] font-medium text-admin-ink/80 transition-colors hover:bg-admin-spot"
            title="Edit hotel & kelola foto"
          >
            <Images className="h-3 w-3" /> Kelola
          </a>
          <button onClick={() => toggleActive(h.id, h.isActive)} className="admin-btn-ghost px-2 py-1 text-[11px]">
            {h.isActive ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hotel"
        actions={<Link href={`/${locale}/admin/products/hotels/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Hotel</Link>}
      />

      <DataTable
        columns={columns}
        rows={hotels}
        getRowId={h => h.id}
        loading={loading}
        empty='Belum ada hotel. Klik "Tambah Hotel" untuk mulai.'
        rowClassName={h => (h.isActive ? undefined : 'opacity-50')}
      />
    </div>
  )
}
