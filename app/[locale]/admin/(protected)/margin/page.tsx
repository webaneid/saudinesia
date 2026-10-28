'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { HeartPulse } from 'lucide-react'
import type { PageMeta } from '@/lib/admin/pagination'
import { formatRupiah } from '@/lib/utils'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { useListPage } from '@/components/admin/data-table/useListPage'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'
import { variantLabel } from '@/components/admin/pricing/PriceCard'
import { cn } from '@/lib/utils'

// Kesehatan Margin (docs/arsitektur-harga-terpadu.md §16): titik harga yang rugi, margin tipis, modal belum lengkap, atau belum berharga — dengan tautan ke editornya.
// Data dari GET /api/v1/admin/pricing/health (peran lewat lib/pricing/policy.ts). Filter di URL supaya bisa di-bookmark.

type Issue = 'loss' | 'thin' | 'no_cost' | 'unpriced'
type Row = {
  ownerType: string; ownerId: string; variantKey: string; unit: string
  costIdr: number | null; sellIdr: number; profitIdr: number | null; marginPct: number | null; mode: 'auto' | 'manual'
  label: string; href: string | null; issues: Issue[]
}
type Counts = Record<Issue, number> & { all: number }

const ISSUE: Record<Issue, { label: string; tone: BadgeTone }> = {
  loss: { label: 'Rugi', tone: 'danger' }, thin: { label: 'Margin tipis', tone: 'warning' },
  no_cost: { label: 'Modal kosong', tone: 'neutral' }, unpriced: { label: 'Belum berharga', tone: 'warning' },
}
const TYPES: Array<{ value: string; label: string }> = [
  { value: 'visa', label: 'Visa' }, { value: 'flight', label: 'Pesawat' }, { value: 'hotel', label: 'Hotel' }, { value: 'transport', label: 'Transport' },
  { value: 'muthowif', label: 'Muthowif' }, { value: 'package', label: 'Paket Umroh' }, { value: 'tour_package', label: 'Paket Ziarah' }, { value: 'haji', label: 'Haji' },
  { value: 'catering', label: 'Katering' }, { value: 'hotel_service', label: 'Layanan Hotel' },
]
const FILTERS: Array<{ value: string; label: string; count: (c: Counts) => number }> = [
  { value: 'issues', label: 'Perlu perhatian', count: c => c.loss + c.thin + c.no_cost + c.unpriced },
  { value: 'loss', label: 'Rugi', count: c => c.loss }, { value: 'thin', label: 'Margin tipis', count: c => c.thin },
  { value: 'no_cost', label: 'Modal kosong', count: c => c.no_cost }, { value: 'unpriced', label: 'Belum berharga', count: c => c.unpriced },
  { value: 'all', label: 'Semua harga', count: c => c.all },
]

export default function MarginHealthPage() {
  const { locale } = useParams() as { locale: string }
  const search = useSearchParams()
  const { page, limit, setPage, setParams } = useListPage()
  const filter = search.get('filter') ?? 'issues'
  const type = search.get('type') ?? ''
  const [rows, setRows] = useState<Row[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [warn, setWarn] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ filter, page: String(page), limit: String(limit), ...(type ? { ownerType: type } : {}) })
      const res = await fetch(`/api/v1/admin/pricing/health?${qs}`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) { setError(j?.error ?? 'Data kesehatan margin gagal dimuat.'); setRows([]); return }
      setRows(j.data); setMeta(j.meta ?? null); setCounts(j.meta?.counts ?? null); setWarn(j.meta?.warnBelowPercent ?? 0)
    } finally { setLoading(false) }
  }, [filter, type, page, limit])
  useEffect(() => { void load() }, [load])

  const columns: Column<Row>[] = [
    {
      key: 'name', header: 'Produk', mobile: 'title',
      cell: r => (
        <div className="min-w-0">
          {r.href ? <Link href={`/${locale}${r.href}`} className="font-semibold text-admin-ink hover:underline">{r.label}</Link> : <span className="font-semibold text-admin-ink">{r.label}</span>}
          {variantLabel(r.variantKey) && <p className="m-0 text-[11px] text-admin-muted">{variantLabel(r.variantKey)}</p>}
        </div>
      ),
    },
    { key: 'cost', header: 'Modal', align: 'right', cell: r => <span className="tabular-nums text-admin-ink/80">{r.costIdr == null ? '—' : formatRupiah(r.costIdr)}</span> },
    { key: 'sell', header: 'Harga jual', align: 'right', cell: r => <span className="font-semibold tabular-nums text-admin-ink">{formatRupiah(r.sellIdr)}</span> },
    {
      key: 'profit', header: 'Untung', align: 'right',
      cell: r => r.profitIdr == null
        ? <span className="text-admin-muted">—</span>
        : <span className={cn('font-semibold tabular-nums', r.profitIdr < 0 ? 'text-admin-danger' : 'text-admin-ok')}>{formatRupiah(r.profitIdr)}{r.marginPct != null && <span className="ml-1 text-[11px] font-medium opacity-80">({r.marginPct.toFixed(1)}%)</span>}</span>,
    },
    { key: 'mode', header: 'Mode', hideBelowLg: true, cell: r => <Badge tone={r.mode === 'manual' ? 'warning' : 'accent'}>{r.mode === 'manual' ? 'Manual' : 'Otomatis'}</Badge> },
    { key: 'issues', header: 'Masalah', cell: r => r.issues.length === 0 ? <span className="text-[11px] text-admin-muted">Sehat</span> : <div className="flex flex-wrap gap-1">{r.issues.map(i => <Badge key={i} tone={ISSUE[i].tone}>{ISSUE[i].label}</Badge>)}</div> },
    { key: 'actions', header: '', actions: true, cell: r => r.href ? <RowActions><ActionLink kind="edit" href={`/${locale}${r.href}`} label={`Atur harga ${r.label}`} /></RowActions> : null },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={HeartPulse}
        title="Kesehatan Margin"
        description={`Harga yang rugi, margin tipis${warn > 0 ? ` (di bawah ${warn}%)` : ' (ambang belum diatur di Pengaturan)'}, modal belum lengkap, atau belum berharga. Tidak memblokir apa pun — hanya menampakkan.`}
      />

      <FilterBar active={filter !== 'issues' || Boolean(type)} resetHref={`/${locale}/admin/margin`}>
        <FilterSelect
          label="Tampilkan" allLabel={`Perlu perhatian${counts ? ` · ${FILTERS[0]!.count(counts)}` : ''}`} value={filter === 'issues' ? '' : filter}
          options={FILTERS.filter(f => f.value !== 'issues').map(f => ({ value: f.value, label: `${f.label}${counts ? ` · ${f.count(counts)}` : ''}` }))}
          onChange={v => setParams({ filter: v || undefined })}
        />
        <FilterSelect label="Jenis" allLabel="Semua jenis" value={type} options={TYPES} onChange={v => setParams({ type: v || undefined })} />
      </FilterBar>

      {error && <p role="alert" className="text-sm font-medium text-admin-danger">{error}</p>}
      <DataTable
        columns={columns} rows={rows} getRowId={r => `${r.ownerType}:${r.ownerId}:${r.variantKey}`} loading={loading}
        empty={filter === 'issues' ? 'Semua harga sehat — tidak ada yang rugi, tipis, kosong modal, atau belum berharga.' : 'Tidak ada data untuk filter ini.'}
        footer={meta ? <Pagination {...meta} onPageChange={setPage} /> : undefined}
      />
    </div>
  )
}
