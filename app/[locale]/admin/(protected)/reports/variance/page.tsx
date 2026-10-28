'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Scale } from 'lucide-react'
import type { PageMeta } from '@/lib/admin/pagination'
import { cn, formatRupiah } from '@/lib/utils'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { PeriodFilter } from '@/components/admin/data-table/PeriodFilter'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { periodPresets } from '@/lib/admin/period'
import { useListPage } from '@/components/admin/data-table/useListPage'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Card } from '@/components/admin/ui/Card'
import { Badge } from '@/components/admin/ui/Badge'

// Selisih HPP vs Aktual (docs/arsitektur-harga-terpadu.md §20, 7D): di mana modal rencana (HPP awal) meleset dari uang yang benar-benar keluar ke vendor. Selisih hanya dari baris yang
// dinyatakan LUNAS; yang belum lunas tampil terpisah. Data dari GET /api/v1/admin/reports/cost-variance (peran lewat lib/pricing/policy.ts). Filter di URL.

type Slice = { lines: number; planIdr: number; actualIdr: number; varianceIdr: number }
type LineRow = { snapshotId: string; bookingId: string; bookingCode: string; createdAt: string; itemType: string; description: string; planIdr: number; actualIdr: number; varianceIdr: number; settled: boolean; notes: string | null }
type Report = {
  params: { from: string; to: string }
  summary: { settled: Slice & { overrunLines: number; savingLines: number; onPlanLines: number }; partial: { lines: number; planIdr: number; paidIdr: number }; spendWithoutPlanIdr: number; totalSpendIdr: number }
  byProduct: Array<Slice & { itemType: string }>
  byMonth: Array<Slice & { month: string }>
  spendByVendor: Array<{ vendorId: string; label: string; spendIdr: number; entries: number }>
  spendByComponent: Array<{ component: string; spendIdr: number; entries: number }>
  lines: LineRow[]
}
const ITEM_LABEL: Record<string, string> = { hotel: 'Hotel', transport: 'Transport', muthowif: 'Muthowif', catering: 'Katering', tourPackage: 'Paket Ziarah', haji: 'Haji', visa: 'Visa', booking: 'Penyesuaian' }

const Var = ({ v }: { v: number }) => <span className={cn('font-semibold tabular-nums', v > 0 ? 'text-admin-danger' : v < 0 ? 'text-admin-ok' : 'text-admin-muted')}>{v > 0 ? '+' : ''}{formatRupiah(v)}</span>
function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className="rounded-xl border border-admin-line bg-white p-3">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">{label}</p>
      <p className={cn('m-0 mt-1 text-lg font-extrabold tabular-nums', tone === 'ok' && 'text-admin-ok', tone === 'danger' && 'text-admin-danger')}>{value}</p>
      {hint && <p className="m-0 mt-0.5 text-[11px] text-admin-muted">{hint}</p>}
    </div>
  )
}
const sliceColumns = <T extends Slice>(): Column<T>[] => [
  { key: 'lines', header: 'Baris', align: 'right', hideBelowLg: true, cell: r => <span className="tabular-nums">{r.lines}</span> },
  { key: 'plan', header: 'Rencana', align: 'right', cell: r => <span className="tabular-nums">{formatRupiah(r.planIdr)}</span> },
  { key: 'actual', header: 'Aktual', align: 'right', cell: r => <span className="tabular-nums">{formatRupiah(r.actualIdr)}</span> },
  { key: 'var', header: 'Selisih', align: 'right', cell: r => <Var v={r.varianceIdr} /> },
]

export default function VariancePage() {
  const { locale } = useParams() as { locale: string }
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const { page, limit, setPage } = useListPage()
  const def = useMemo(() => periodPresets()[0]!, [])
  const from = search.get('from') ?? def.from
  const to = search.get('to') ?? def.to
  const only = search.get('only') === 'variance'
  const [data, setData] = useState<Report | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ from, to, page: String(page), limit: String(limit), ...(only ? { only: 'variance' } : {}) })
      const res = await fetch(`/api/v1/admin/reports/cost-variance?${qs}`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) { setError(j?.error ?? 'Laporan gagal dimuat.'); setData(null); return }
      setData(j.data); setMeta(j.meta ?? null)
    } finally { setLoading(false) }
  }, [from, to, page, limit, only])
  useEffect(() => { void load() }, [load])

  const go = (next: Record<string, string>) => router.replace(`${pathname}?${new URLSearchParams({ from, to, ...(only ? { only: 'variance' } : {}), ...next })}`, { scroll: false })
  const s = data?.summary

  const lineColumns: Column<LineRow>[] = [
    { key: 'b', header: 'Baris', mobile: 'title', cell: r => (
      <div className="min-w-0">
        <p className="m-0 font-semibold text-admin-ink">{r.description}</p>
        <p className="m-0 text-[11px] text-admin-muted"><Link href={`/${locale}/admin/bookings/${r.bookingId}`} className="hover:underline">{r.bookingCode}</Link> · {ITEM_LABEL[r.itemType] ?? r.itemType}</p>
      </div>
    ) },
    { key: 'st', header: 'Status', hideBelowLg: true, cell: r => <Badge tone={r.settled ? 'accent' : 'warning'}>{r.settled ? 'Lunas' : 'Belum lunas'}</Badge> },
    { key: 'plan', header: 'Rencana', align: 'right', cell: r => <span className="tabular-nums">{formatRupiah(r.planIdr)}</span> },
    { key: 'act', header: 'Aktual', align: 'right', cell: r => <span className="tabular-nums">{formatRupiah(r.actualIdr)}</span> },
    { key: 'var', header: 'Selisih', align: 'right', cell: r => r.settled ? <Var v={r.varianceIdr} /> : <span className="text-admin-muted">—</span> },
    { key: 'note', header: 'Catatan', hideBelowLg: true, cell: r => <span className="text-[11px] text-admin-muted">{r.notes ?? ''}</span> },
    { key: 'actions', header: '', actions: true, cell: r => <RowActions><ActionLink kind="view" href={`/${locale}/admin/bookings/${r.bookingId}`} label={`Lihat booking ${r.bookingCode}`} /></RowActions> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Scale}
        title="Selisih HPP vs Aktual"
        description="Di mana modal rencana meleset dari uang yang benar-benar keluar ke vendor. Selisih hanya dari baris yang dinyatakan lunas."
        actions={<Link href={`/${locale}/admin/reports`} className="admin-btn-sm">Laporan Untung</Link>}
      />
      <FilterBar active={from !== def.from || to !== def.to || only} resetHref={pathname}>
        <PeriodFilter from={from} to={to} onChange={r => go({ from: r.from, to: r.to, page: '1' })} />
        <FilterSelect label="Baris" allLabel="Semua baris" value={only ? 'variance' : ''} options={[{ value: 'variance', label: 'Hanya yang selisih' }]} onChange={v => { const q = new URLSearchParams({ from, to, page: '1' }); if (v) q.set('only', 'variance'); router.replace(`${pathname}?${q}`, { scroll: false }) }} />
      </FilterBar>

      {error && <p role="alert" className="text-sm font-medium text-admin-danger">{error}</p>}

      {s && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Rencana (lunas)" value={formatRupiah(s.settled.planIdr)} hint={`${s.settled.lines} baris lunas`} />
            <Stat label="Aktual (lunas)" value={formatRupiah(s.settled.actualIdr)} />
            <Stat label="Selisih" value={`${s.settled.varianceIdr > 0 ? '+' : ''}${formatRupiah(s.settled.varianceIdr)}`} tone={s.settled.varianceIdr > 0 ? 'danger' : s.settled.varianceIdr < 0 ? 'ok' : undefined} hint={`${s.settled.overrunLines} lebih mahal · ${s.settled.savingLines} lebih hemat · ${s.settled.onPlanLines} sesuai`} />
            <Stat label="Total uang keluar" value={formatRupiah(s.totalSpendIdr)} hint={`${formatRupiah(s.spendWithoutPlanIdr)} tanpa rencana pembanding`} />
          </div>
          {s.partial.lines > 0 && (
            <p className="m-0 text-xs text-admin-muted">{s.partial.lines} baris belum lunas: rencana {formatRupiah(s.partial.planIdr)}, terbayar sejauh ini {formatRupiah(s.partial.paidIdr)} — belum masuk selisih.</p>
          )}
        </>
      )}

      {data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="space-y-2 p-4">
            <h2 className="m-0 text-sm font-bold">Selisih per produk</h2>
            <DataTable columns={[{ key: 'p', header: 'Produk', mobile: 'title', cell: (r: Report['byProduct'][number]) => <span className="font-semibold text-admin-ink">{ITEM_LABEL[r.itemType] ?? r.itemType}</span> }, ...sliceColumns<Report['byProduct'][number]>()]}
              rows={data.byProduct} getRowId={r => r.itemType} loading={loading} empty="Belum ada baris lunas pada periode ini." />
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="m-0 text-sm font-bold">Selisih per bulan pesanan</h2>
            <DataTable columns={[{ key: 'm', header: 'Bulan', mobile: 'title', cell: (r: Report['byMonth'][number]) => <span className="font-semibold text-admin-ink">{r.month}</span> }, ...sliceColumns<Report['byMonth'][number]>()]}
              rows={data.byMonth} getRowId={r => r.month} loading={loading} empty="Belum ada baris lunas pada periode ini." />
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="m-0 text-sm font-bold">Uang keluar per vendor</h2>
            <DataTable columns={[{ key: 'v', header: 'Vendor', mobile: 'title', cell: (r: Report['spendByVendor'][number]) => <span className="font-semibold text-admin-ink">{r.label}</span> }, { key: 'n', header: 'Catatan', align: 'right', hideBelowLg: true, cell: r => <span className="tabular-nums">{r.entries}</span> }, { key: 's', header: 'Dibayar', align: 'right', cell: r => <span className="font-semibold tabular-nums">{formatRupiah(r.spendIdr)}</span> }]}
              rows={data.spendByVendor} getRowId={r => r.vendorId} loading={loading} empty="Belum ada pengeluaran pada periode ini." />
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="m-0 text-sm font-bold">Uang keluar per komponen</h2>
            <DataTable columns={[{ key: 'c', header: 'Komponen', mobile: 'title', cell: (r: Report['spendByComponent'][number]) => <span className="font-semibold text-admin-ink">{r.component}</span> }, { key: 'n', header: 'Catatan', align: 'right', hideBelowLg: true, cell: r => <span className="tabular-nums">{r.entries}</span> }, { key: 's', header: 'Dibayar', align: 'right', cell: r => <span className="font-semibold tabular-nums">{formatRupiah(r.spendIdr)}</span> }]}
              rows={data.spendByComponent} getRowId={r => r.component} loading={loading} empty="Belum ada pengeluaran pada periode ini." />
          </Card>
        </div>
      )}

      <Card className="space-y-2 p-4">
        <h2 className="m-0 text-sm font-bold">Per baris rencana</h2>
        <DataTable columns={lineColumns} rows={data?.lines ?? []} getRowId={r => r.snapshotId} loading={loading} empty="Tidak ada baris pada periode ini." footer={meta ? <Pagination {...meta} onPageChange={setPage} /> : undefined} />
      </Card>
    </div>
  )
}
