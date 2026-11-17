'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BookOpenCheck, Download } from 'lucide-react'
import type { CashComponent, CashDirection } from '@prisma/client'
import type { PageMeta } from '@/lib/admin/pagination'
import { cn, formatRupiah } from '@/lib/utils'
import { DATE_SHORT_MONTH, DATETIME_MEDIUM, formatCalendarDate, formatInstant } from '@/lib/time'
import { CASH_COMPONENT_LABEL, CASH_DIRECTION_LABEL } from '@/lib/cash/labels'
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

// Buku kas (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-1): baca saja. Data dari GET /api/v1/admin/finance/cash-book; filter di URL (daftar putih di server).

type Row = { id: string; entryDate: string; direction: CashDirection; component: CashComponent; amountIdr: number; account: string; bookingId: string | null; bookingCode: string | null; refType: string }
type AccountSummary = { id: string; name: string; inIdr: number; outIdr: number; openingIdr: number; closingIdr: number }
type Data = { params: { from: string; to: string }; summary: { accounts: AccountSummary[]; inIdr: number; outIdr: number }; accounts: Array<{ id: string; name: string }>; rows: Row[] }

const FILTERS = ['account', 'direction', 'component'] as const

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className="rounded-xl border border-admin-line bg-white p-3">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">{label}</p>
      <p className={cn('m-0 mt-1 text-lg font-extrabold tabular-nums', tone === 'ok' && 'text-admin-ok', tone === 'danger' && 'text-admin-danger')}>{value}</p>
      {hint && <p className="m-0 mt-0.5 text-[11px] text-admin-muted">{hint}</p>}
    </div>
  )
}

export default function CashBookPage() {
  const { locale } = useParams() as { locale: string }
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const { page, limit, setPage } = useListPage()
  const def = useMemo(() => periodPresets()[0]!, [])
  const from = search.get('from') ?? def.from
  const to = search.get('to') ?? def.to
  const picked = Object.fromEntries(FILTERS.map(k => [k, search.get(k) ?? ''])) as Record<(typeof FILTERS)[number], string>
  const [data, setData] = useState<Data | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const query = useCallback((extra: Record<string, string>) => {
    const q = new URLSearchParams({ from, to })
    for (const k of FILTERS) if (picked[k]) q.set(k, picked[k])
    for (const [k, v] of Object.entries(extra)) { if (v) q.set(k, v); else q.delete(k) }
    return q
  }, [from, to, picked.account, picked.direction, picked.component]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/v1/admin/finance/cash-book?${query({ page: String(page), limit: String(limit) })}`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) { setError(j?.error ?? 'Buku kas gagal dimuat.'); setData(null); return }
      setData(j.data); setMeta(j.meta ?? null)
    } finally { setLoading(false) }
  }, [query, page, limit])
  useEffect(() => { void load() }, [load])

  const go = (extra: Record<string, string>) => router.replace(`${pathname}?${query({ ...extra, page: '1' })}`, { scroll: false })
  const s = data?.summary

  const columns: Column<Row>[] = [
    { key: 'd', header: 'Waktu', mobile: 'title', cell: r => <span className="tabular-nums">{formatInstant(r.entryDate, DATETIME_MEDIUM)}</span> },
    { key: 'k', header: 'Komponen', cell: r => <Badge tone={r.direction === 'in' ? 'accent' : 'warning'}>{CASH_DIRECTION_LABEL[r.direction]} · {CASH_COMPONENT_LABEL[r.component]}</Badge> },
    { key: 'a', header: 'Akun', hideBelowLg: true, cell: r => <span className="text-admin-ink">{r.account}</span> },
    { key: 'b', header: 'Booking', cell: r => r.bookingId ? <Link href={`/${locale}/admin/bookings/${r.bookingId}`} className="hover:underline">{r.bookingCode ?? 'Booking terhapus'}</Link> : <span className="text-admin-muted">—</span> },
    { key: 'n', header: 'Jumlah', align: 'right', cell: r => <span className={cn('font-semibold tabular-nums', r.direction === 'in' ? 'text-admin-ok' : 'text-admin-danger')}>{r.direction === 'in' ? '+' : '−'}{formatRupiah(r.amountIdr)}</span> },
    { key: 'actions', header: '', actions: true, cell: r => r.bookingId && r.bookingCode ? <RowActions><ActionLink kind="view" href={`/${locale}/admin/bookings/${r.bookingId}`} label={`Lihat booking ${r.bookingCode}`} /></RowActions> : null },
  ]

  return (
    <div className="space-y-5">
      <PageHeader icon={BookOpenCheck} title="Buku Kas" description="Uang masuk dan keluar per akun kas. Dicatat otomatis saat pembayaran diverifikasi; tidak dapat diubah — koreksi tercatat sebagai entri pembalik."
        actions={<><Link href={`/${locale}/admin/finance/cash-flow?${new URLSearchParams({ from, to, ...(picked.account ? { account: picked.account } : {}) })}`} className="admin-btn-sm">Arus Kas</Link><a href={`/api/v1/admin/finance/cash-book/export?${query({})}`} className="admin-btn-sm inline-flex items-center gap-1.5"><Download className="size-3.5" />Unduh CSV</a></>} />
      <FilterBar active={from !== def.from || to !== def.to || FILTERS.some(k => picked[k])} resetHref={pathname}>
        <PeriodFilter from={from} to={to} onChange={r => go({ from: r.from, to: r.to })} />
        <FilterSelect label="Akun" allLabel="Semua akun" value={picked.account} options={(data?.accounts ?? []).map(a => ({ value: a.id, label: a.name }))} onChange={v => go({ account: v })} />
        <FilterSelect label="Arah" allLabel="Masuk & keluar" value={picked.direction} options={(['in', 'out'] as const).map(v => ({ value: v, label: CASH_DIRECTION_LABEL[v] }))} onChange={v => go({ direction: v })} />
        <FilterSelect label="Komponen" allLabel="Semua komponen" value={picked.component} options={(Object.keys(CASH_COMPONENT_LABEL) as CashComponent[]).map(v => ({ value: v, label: CASH_COMPONENT_LABEL[v] }))} onChange={v => go({ component: v })} />
      </FilterBar>

      {error && <p role="alert" className="text-sm font-medium text-admin-danger">{error}</p>}

      {s && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <Stat label="Masuk (periode)" value={formatRupiah(s.inIdr)} tone="ok" />
          <Stat label="Keluar (periode)" value={formatRupiah(s.outIdr)} tone={s.outIdr > 0 ? 'danger' : undefined} />
          <Stat label="Bersih (periode)" value={formatRupiah(s.inIdr - s.outIdr)} />
        </div>
      )}

      {s && (
        <Card className="space-y-2 p-4">
          <h2 className="m-0 text-sm font-bold">Saldo per akun kas</h2>
          <p className="m-0 text-[11px] text-admin-muted">Saldo awal dan akhir periode memuat semua entri akun (filter arah/komponen hanya memengaruhi kolom masuk/keluar).</p>
          <DataTable
            columns={[
              { key: 'n', header: 'Akun', mobile: 'title', cell: (r: AccountSummary) => <span className="font-semibold text-admin-ink">{r.name}</span> },
              { key: 's', header: `Saldo awal ${formatCalendarDate(from, DATE_SHORT_MONTH)}`, align: 'right', hideBelowLg: true, cell: r => <span className="tabular-nums text-admin-muted">{formatRupiah(r.openingIdr)}</span> },
              { key: 'i', header: 'Masuk', align: 'right', cell: r => <span className="tabular-nums">{formatRupiah(r.inIdr)}</span> },
              { key: 'o', header: 'Keluar', align: 'right', cell: r => <span className="tabular-nums">{formatRupiah(r.outIdr)}</span> },
              { key: 'b', header: `Saldo per ${formatCalendarDate(to, DATE_SHORT_MONTH)}`, align: 'right', cell: r => <span className="font-semibold tabular-nums">{formatRupiah(r.closingIdr)}</span> },
            ]}
            rows={s.accounts} getRowId={r => r.id} loading={loading} empty="Belum ada akun kas — akun dibuat saat pembayaran pertama masuk ke rekening."
          />
        </Card>
      )}

      <Card className="space-y-2 p-4">
        <h2 className="m-0 text-sm font-bold">Entri</h2>
        <DataTable columns={columns} rows={data?.rows ?? []} getRowId={r => r.id} loading={loading} empty="Tidak ada entri pada periode ini." footer={meta ? <Pagination {...meta} onPageChange={setPage} /> : undefined} />
      </Card>
    </div>
  )
}
