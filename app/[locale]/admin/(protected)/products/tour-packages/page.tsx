'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Pencil, Landmark } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type TourPackage = {
  id: string; name: string; price: string | number; isActive: boolean
  transportMode: 'included' | 'user_choice' | 'none'
  transportTrip: { name: string; origin: string; destination: string } | null
  includedTransportPricing: { vehicle: { name: string } } | null
  _count: { sites: number }
}

export default function TourPackagesPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }

  const [list, setList] = useState<TourPackage[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const r = await fetch('/api/v1/admin/products/tour-packages')
    const j = await r.json()
    setList(j.data ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function formatPrice(p: string | number) {
    const n = Number(p)
    return n > 0 ? `Rp ${n.toLocaleString('id-ID')}` : '—'
  }

  function transportLabel(p: TourPackage) {
    if (p.transportMode === 'included' && p.includedTransportPricing) return `${p.includedTransportPricing.vehicle.name} (included)`
    if (p.transportMode === 'user_choice' && p.transportTrip) return `${p.transportTrip.origin} → ${p.transportTrip.destination} (user choice)`
    return '— tanpa kendaraan —'
  }

  const columns: Column<TourPackage>[] = [
    { key: 'name', header: 'Nama Paket', mobile: 'title', cell: p => <span className="text-[13px] font-medium">{p.name}</span> },
    { key: 'transport', header: 'Kendaraan', cell: p => <span className="text-[12px] text-admin-muted">{transportLabel(p)}</span> },
    { key: 'sites', header: 'Situs', cell: p => <span className="text-[12px] text-admin-muted">{p._count.sites} situs</span> },
    { key: 'price', header: 'Harga Jual Paket', cell: p => <span className="text-[12px] font-medium text-admin-ink/80">{formatPrice(p.price)}</span> },
    { key: 'status', header: 'Status', cell: p => <Badge tone={p.isActive ? 'ok' : 'neutral'}>{p.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: p => (
        <button onClick={() => router.push(`/${locale}/admin/products/tour-packages/${p.id}`)}
          className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
          <Pencil className="h-3.5 w-3.5" /> Kelola
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Landmark}
        title="Paket Ziarah"
        description="Paket wisata ziarah — kendaraan & hotel dikonfigurasi di halaman Kelola setelah paket dibuat."
        actions={<Link href={`/${locale}/admin/products/tour-packages/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>}
      />

      <DataTable columns={columns} rows={list} getRowId={p => p.id} loading={loading} empty="Belum ada paket ziarah." rowClassName={p => (p.isActive ? undefined : 'opacity-50')} />
    </div>
  )
}
