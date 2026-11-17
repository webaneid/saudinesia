'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BadgePercent, Download } from 'lucide-react'
import type { BookingStatus } from '@prisma/client'
import type { PageMeta } from '@/lib/admin/pagination'
import { cn, formatRupiah } from '@/lib/utils'
import { DATE_MEDIUM, formatInstant } from '@/lib/time'
import { periodPresets } from '@/lib/admin/period'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { PeriodFilter } from '@/components/admin/data-table/PeriodFilter'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { useListPage } from '@/components/admin/data-table/useListPage'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Card } from '@/components/admin/ui/Card'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'

// Laporan PPN (docs/arsitektur-booking-engine-v2.md §10.14 Fase 12c, K12-3): ditagihkan (invoice terbit dalam periode) vs diterima (buku kas dalam periode).
// Baca saja; data dari GET /api/v1/admin/finance/tax (aturan hitung di lib/reports/tax.ts). Filter di URL.

type Bucket = { count: number; addedIdr: number; includedIdr: number; totalIdr: number }
type Summary = { from: string; to: string; billed: Bucket; billedVoid: Bucket; received: { addedIdr: number; includedIdr: number; grossIdr: number; refundIdr: number; netIdr: number } }
type Row = { bookingId: string; bookingCode: string; invoiceNumber: string; issuedAt: string; status: BookingStatus; subtotalIdr: number; addedIdr: number; includedIdr: number; receivedIdr: number }

const STATUS: Record<BookingStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draf', tone: 'neutral' }, active: { label: 'Berjalan', tone: 'accent' }, completed: { label: 'Selesai', tone: 'ok' },
  cancelled: { label: 'Batal', tone: 'danger' }, expired: { label: 'Hangus', tone: 'warning' },
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className="rounded-xl border border-admin-line bg-white p-3">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">{label}</p>
      <p className={cn('m-0 mt-1 text-lg font-extrabold tabular-nums', tone === 'ok' && 'text-admin-ok', tone === 'danger' && 'text-admin-danger')}>{value}</p>
      {hint && <p className="m-0 mt-0.5 text-[11px] text-admin-muted">{hint}</p>}
    </div>
  )
}

function Line({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1 text-[13px]', strong && 'border-t border-admin-line pt-2 font-semibold')}>
      <span className={strong ? 'text-admin-ink' : 'text-admin-muted'}>{label}</span>
      <span className="tabular-nums text-admin-ink">{minus && value > 0 ? '−' : ''}{formatRupiah(value)}</span>
    </div>
  )
}

export default function TaxReportPage() {
  const { locale } = useParams() as { locale: string }
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const { page, limit, setPage } = useListPage()
  const def = useMemo(() => periodPresets()[0]!, [])
  const from = search.get('from') ?? def.from
  const to = search.get('to') ?? def.to
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const query = useCallback((extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ from, to })
    for (const [k, v] of Object.entries(extra)) { if (v) q.set(k, v); else q.delete(k) }
    return q
  }, [from, to])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/v1/admin/finance/tax?${query({ page: String(page), limit: String(limit) })}`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) { setError(j?.error ?? 'Laporan PPN gagal dimuat.'); setSummary(null); setRows([]); return }
      setSummary(j.data.summary); setRows(j.data.invoices); setMeta(j.meta ?? null)
    } catch { setError('Tidak dapat menghubungi server.') } finally { setLoading(false) }
  }, [query, page, limit])
  useEffect(() => { void load() }, [load])

  const go = (extra: Record<string, string>) => router.replace(`${pathname}?${query({ ...extra, page: '1' })}`, { scroll: false })
  const s = summary

  const columns: Column<Row>[] = [
    { key: 'n', header: 'Invoice', mobile: 'title', cell: r => (
      <div className="min-w-0">
        <Link href={`/${locale}/admin/bookings/${r.bookingId}`} className="font-mono text-[12px] font-semibold text-admin-accent hover:text-admin-accent-strong">{r.invoiceNumber}</Link>
        <p className="m-0 text-[11px] text-admin-muted">{r.bookingCode} · {formatInstant(r.issuedAt, DATE_MEDIUM)}</p>
      </div>
    ) },
    { key: 's', header: 'Status', cell: r => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
    { key: 'd', header: 'Subtotal', align: 'right', hideBelowLg: true, cell: r => <span className="tabular-nums text-admin-muted">{formatRupiah(r.subtotalIdr)}</span> },
    { key: 'a', header: 'PPN ditambahkan', align: 'right', cell: r => <span className="tabular-nums">{formatRupiah(r.addedIdr)}</span> },
    { key: 'i', header: 'PPN termasuk', align: 'right', hideBelowLg: true, cell: r => <span className="tabular-nums">{formatRupiah(r.includedIdr)}</span> },
    { key: 'r', header: 'Diterima s.d. akhir periode', align: 'right', cell: r => <span className="font-semibold tabular-nums">{formatRupiah(r.receivedIdr)}</span> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader icon={BadgePercent} title="Laporan PPN" description="PPN yang ditagihkan lewat invoice dibandingkan PPN yang benar-benar diterima menurut buku kas, per periode."
        actions={<a href={`/api/v1/admin/finance/tax/export?${query()}`} className="admin-btn-sm inline-flex items-center gap-1.5"><Download className="size-3.5" />Unduh CSV</a>} />
      <FilterBar active={from !== def.from || to !== def.to} resetHref={pathname}>
        <PeriodFilter from={from} to={to} onChange={r => go({ from: r.from, to: r.to })} />
      </FilterBar>

      {error && <p role="alert" className="text-sm font-medium text-admin-danger">{error}</p>}

      {s && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="PPN ditagihkan" value={formatRupiah(s.billed.totalIdr)} hint={`${s.billed.count} invoice terbit`} />
          <Stat label="PPN diterima bersih" value={formatRupiah(s.received.netIdr)} tone="ok" hint="Buku kas, dikurangi refund" />
          <Stat label="Belum diterima (periode)" value={formatRupiah(Math.max(Math.round((s.billed.totalIdr - s.received.netIdr) * 100) / 100, 0))} hint="Ditagihkan − diterima bersih" />
          <Stat label="Invoice batal/hangus" value={formatRupiah(s.billedVoid.totalIdr)} hint={`${s.billedVoid.count} invoice · tak dihitung`} />
        </div>
      )}

      {s && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-1 p-4">
            <h2 className="m-0 text-sm font-bold">Ditagihkan</h2>
            <p className="m-0 text-[12px] text-admin-muted">Invoice yang terbit dalam periode (nilai terkini sesudah revisi), booking yang tidak batal/hangus.</p>
            <Line label="PPN ditambahkan ke tagihan" value={s.billed.addedIdr} />
            <Line label="PPN di dalam harga" value={s.billed.includedIdr} />
            <Line label="Total PPN ditagihkan" value={s.billed.totalIdr} strong />
          </Card>
          <Card className="space-y-1 p-4">
            <h2 className="m-0 text-sm font-bold">Diterima</h2>
            <p className="m-0 text-[12px] text-admin-muted">Uang yang masuk dalam periode menurut buku kas. PPN di dalam harga dan bagian PPN refund dihitung proporsional dari komposisi invoice — perkiraan, bukan angka resmi pajak.</p>
            <Line label="PPN ditambahkan (entri PPN)" value={s.received.addedIdr} />
            <Line label="PPN di dalam harga (proporsional)" value={s.received.includedIdr} />
            <Line label="Bagian PPN refund dibayar" value={s.received.refundIdr} minus />
            <Line label="PPN diterima bersih" value={s.received.netIdr} strong />
          </Card>
        </div>
      )}

      <Card className="space-y-2 p-4">
        <h2 className="m-0 text-sm font-bold">Invoice terbit dalam periode</h2>
        <DataTable columns={columns} rows={rows} getRowId={r => r.bookingId} loading={loading} empty="Tidak ada invoice yang terbit pada periode ini."
          footer={meta ? <Pagination {...meta} onPageChange={setPage} /> : undefined} />
      </Card>
    </div>
  )
}
