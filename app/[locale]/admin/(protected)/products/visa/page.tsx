'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { Plus, KeyRound, Pencil, Globe } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'
import { ProfitCell } from '@/components/admin/pricing/ProfitCell'

const COMMON_DOC_TYPES = [
  'passport', 'ktp', 'kk', 'photo', 'evaksin', 'etiket',
  'rekening', 'sponsor', 'iqomah', 'surat_nikah', 'akta_lahir', 'ijazah',
]

type VisaProduct = {
  id: string; name: string; country: string; visaType: string
  price: number; profitIdr: number | null; marginPct: number | null; processDays: number; isActive: boolean
}

export default function VisaPage() {
  const router = useRouter()
  const [list,   setList]   = useState<VisaProduct[]>([])
  const [locale, setLocale] = useState('id')

  async function load() {
    const r = await fetch('/api/v1/admin/products/visa')
    const j = await r.json()
    setList(j.data ?? [])
  }

  useEffect(() => {
    load()
    // detect locale from URL
    const parts = window.location.pathname.split('/')
    if (parts[1]) setLocale(parts[1])
  }, [])

  const grouped = list.reduce<Record<string, VisaProduct[]>>((acc, v) => {
    const key = v.country || 'Saudi Arabia'
    acc[key] = acc[key] ?? []
    acc[key].push(v)
    return acc
  }, {})

  const columns: Column<VisaProduct>[] = [
    { key: 'name', header: 'Nama', mobile: 'title', cell: v => <span className="text-[13px] font-medium">{v.name}</span> },
    { key: 'type', header: 'Jenis', cell: v => <Badge tone="accent">{v.visaType}</Badge> },
    { key: 'price', header: 'Harga', align: 'right', cell: v => <span className="text-[12px] font-semibold tabular-nums text-admin-ink/80">{formatRupiah(v.price)}</span> },
    { key: 'profit', header: 'Untung', align: 'right', hideBelowLg: true, cell: v => <ProfitCell profitIdr={v.profitIdr} marginPct={v.marginPct} /> },
    { key: 'process', header: 'Proses', align: 'right', cell: v => <span className="text-[12px] text-admin-muted">{v.processDays} hari</span> },
    { key: 'status', header: 'Status', cell: v => <Badge tone={v.isActive ? 'ok' : 'neutral'}>{v.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: v => (
        <button
          onClick={() => router.push(`/${locale}/admin/products/visa/${v.id}`)}
          className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={KeyRound}
        title="Produk Visa"
        description="Kelola jenis dan harga visa — bisa multi-negara"
        actions={<Link href={`/${locale}/admin/products/visa/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Produk Visa</Link>}
      />

      {Object.entries(grouped).length === 0 && (
        <div className="admin-card p-10 text-center text-admin-muted/70 text-sm">
          Belum ada produk visa. Klik Tambah untuk mulai.
        </div>
      )}

      {Object.entries(grouped).map(([country, items]) => (
        <div key={country} className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-admin-muted uppercase tracking-wide">
            <Globe className="h-3.5 w-3.5" /> {country}
          </div>
          <DataTable columns={columns} rows={items} getRowId={v => v.id} rowClassName={v => (v.isActive ? undefined : 'opacity-50')} />
        </div>
      ))}
    </div>
  )
}
