'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Download, LineChart } from 'lucide-react'
import type { PageMeta } from '@/lib/admin/pagination'
import { cn, formatRupiah } from '@/lib/utils'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { useListPage } from '@/components/admin/data-table/useListPage'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Card } from '@/components/admin/ui/Card'
import { Badge } from '@/components/admin/ui/Badge'

// Laporan untung (docs/arsitektur-harga-terpadu.md §19): semua angka dari snapshot harga yang dibekukan saat dipesan. Data dari GET /api/v1/admin/reports/profit
// (peran lewat lib/pricing/policy.ts). Filter di URL supaya bisa di-bookmark. Untung hanya dihitung dari baris yang modalnya diketahui — sisanya ditampilkan terpisah.

type Figures = {
  sellIdr: number; costKnownIdr: number; sellUnknownCostIdr: number; profitIdr: number; marginPct: number | null; costCoveragePct: number | null; realizedSellIdr: number; realizedProfitIdr: number
}
type Report = {
  params: { from: string; to: string; scope: 'recognized' | 'with_pending' }
  summary: Figures & { bookings: number; paidIdr: number; refundedIdr: number; lossBookings: number }
  cancelledRetained: { bookings: number; retainedIdr: number }
  byProduct: Array<Figures & { itemType: string }>
  byVendor: Array<Figures & { label: string; kind: 'vendor' | 'multi' | 'none' }>
  byMonth: Array<Figures & { month: string }>
  bookings: BookingRow[]
}
type BookingRow = Figures & { id: string; bookingCode: string; createdAt: string; status: string; totalIdr: number; paidIdr: number; refundedIdr: number; realizedRatio: number }

const ITEM_LABEL: Record<string, string> = {
  hotel: 'Hotel', transport: 'Transport', muthowif: 'Muthowif', catering: 'Katering', tourPackage: 'Paket Ziarah', haji: 'Haji', visa: 'Visa', booking: 'Penyesuaian tingkat-booking',
}
const STATUS_LABEL: Record<string, string> = {
  awaiting_payment: 'Menunggu bayar', payment_review: 'Verifikasi bayar', confirmed: 'Dikonfirmasi', active: 'Berjalan', completed: 'Selesai', cancelled: 'Batal',
}

const wibDate = (d: Date): string => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
function presets(): Array<{ key: string; label: string; from: string; to: string }> {
  const today = wibDate(new Date())
  const month = today.slice(0, 8)
  const lastMonthEnd = addDays(`${month}01`, -1)
  return [
    { key: 'month', label: 'Bulan ini', from: `${month}01`, to: today },
    { key: 'prev', label: 'Bulan lalu', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { key: '90', label: '90 hari', from: addDays(today, -89), to: today },
    { key: 'year', label: 'Tahun ini', from: `${today.slice(0, 5)}01-01`, to: today },
  ]
}

const Rp = ({ v }: { v: number }) => <span className="tabular-nums">{formatRupiah(v)}</span>
function Profit({ f }: { f: Figures }) {
  return <span className={cn('font-semibold tabular-nums', f.profitIdr < 0 ? 'text-admin-danger' : 'text-admin-ok')}>{formatRupiah(f.profitIdr)}{f.marginPct != null && <span className="ml-1 text-[11px] font-medium opacity-80">({f.marginPct.toFixed(1)}%)</span>}</span>
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

/** Irisan yang SELURUH penjualannya tanpa modal: modal/untung tampil "—" (bukan Rp 0 yang menyesatkan). */
const hasKnownCost = (f: Figures) => f.sellIdr - f.sellUnknownCostIdr !== 0 || f.costKnownIdr !== 0
const Dash = () => <span className="text-admin-muted">—</span>

/** Kolom angka seragam untuk tabel irisan. */
function figureColumns<T extends Figures>(): Column<T>[] {
  return [
    { key: 'sell', header: 'Penjualan', align: 'right', cell: r => <Rp v={r.sellIdr} /> },
    { key: 'cost', header: 'Modal', align: 'right', hideBelowLg: true, cell: r => hasKnownCost(r) ? <Rp v={r.costKnownIdr} /> : <Dash /> },
    { key: 'unknown', header: 'Tanpa modal', align: 'right', hideBelowLg: true, cell: r => r.sellUnknownCostIdr > 0 ? <span className="tabular-nums text-admin-muted">{formatRupiah(r.sellUnknownCostIdr)}</span> : <Dash /> },
    { key: 'profit', header: 'Untung', align: 'right', cell: r => hasKnownCost(r) ? <Profit f={r} /> : <Dash /> },
  ]
}

export default function ProfitReportPage() {
  const { locale } = useParams() as { locale: string }
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const { page, limit, setPage } = useListPage()
  const def = useMemo(() => presets()[0]!, [])
  const from = search.get('from') ?? def.from
  const to = search.get('to') ?? def.to
  const scope = search.get('scope') === 'with_pending' ? 'with_pending' : 'recognized'
  const onlyLoss = search.get('loss') === '1'
  const [data, setData] = useState<Report | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const qs = useCallback((extra: Record<string, string> = {}) => new URLSearchParams({ from, to, scope, ...(onlyLoss ? { onlyLoss: '1' } : {}), ...extra }), [from, to, scope, onlyLoss])
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/v1/admin/reports/profit?${qs({ page: String(page), limit: String(limit) })}`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) { setError(j?.error ?? 'Laporan gagal dimuat.'); setData(null); return }
      setData(j.data); setMeta(j.meta ?? null)
    } finally { setLoading(false) }
  }, [qs, page, limit])
  useEffect(() => { void load() }, [load])

  const go = (next: Record<string, string>) => router.replace(`${pathname}?${new URLSearchParams({ from, to, scope, ...(onlyLoss ? { loss: '1' } : {}), ...next })}`, { scroll: false })
  const s = data?.summary

  const bookingColumns: Column<BookingRow>[] = [
    { key: 'code', header: 'Booking', mobile: 'title', cell: r => (
      <div className="min-w-0">
        <Link href={`/${locale}/admin/bookings/${r.id}`} className="font-semibold text-admin-ink hover:underline">{r.bookingCode}</Link>
        <p className="m-0 text-[11px] text-admin-muted">{r.createdAt.slice(0, 10)}</p>
      </div>
    ) },
    { key: 'status', header: 'Status', hideBelowLg: true, cell: r => <Badge tone={r.status === 'cancelled' ? 'danger' : r.status === 'awaiting_payment' || r.status === 'payment_review' ? 'warning' : 'accent'}>{STATUS_LABEL[r.status] ?? r.status}</Badge> },
    ...figureColumns<BookingRow>(),
    { key: 'real', header: 'Terealisasi', align: 'right', hideBelowLg: true, cell: r => <span className="tabular-nums text-admin-ink/80">{Math.round(r.realizedRatio * 100)}%</span> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={LineChart}
        title="Laporan Untung"
        description="Dihitung dari harga yang dibekukan saat dipesan — tidak bergeser oleh kurs atau harga sesudahnya. Untung hanya dari baris yang modalnya diketahui."
        actions={<><Link href={`/${locale}/admin/reports/variance`} className="admin-btn-sm">Selisih HPP vs Aktual</Link><a href={`/api/v1/admin/reports/profit/export?${qs()}`} className="admin-btn-sm inline-flex items-center gap-1.5"><Download className="size-3.5" />Unduh CSV</a></>}
      />

      <div className="flex flex-wrap items-center gap-2">
        {presets().map(p => (
          <button key={p.key} type="button" onClick={() => go({ from: p.from, to: p.to, page: '1' })}
            className={cn('rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors', from === p.from && to === p.to ? 'border-admin-accent bg-admin-accent text-white' : 'border-admin-line bg-white text-admin-muted hover:bg-admin-spot')}>
            {p.label}
          </button>
        ))}
        <input type="date" aria-label="Dari tanggal" className="admin-inp w-40" value={from} max={to} onChange={e => e.target.value && go({ from: e.target.value, page: '1' })} />
        <span className="text-xs text-admin-muted">s/d</span>
        <input type="date" aria-label="Sampai tanggal" className="admin-inp w-40" value={to} min={from} onChange={e => e.target.value && go({ to: e.target.value, page: '1' })} />
        <label className="ml-auto flex items-center gap-2 text-xs font-medium text-admin-muted">
          <input type="checkbox" checked={scope === 'with_pending'} onChange={e => go({ scope: e.target.checked ? 'with_pending' : 'recognized', page: '1' })} />
          Termasuk yang belum dibayar
        </label>
      </div>

      {error && <p role="alert" className="text-sm font-medium text-admin-danger">{error}</p>}

      {s && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Penjualan" value={formatRupiah(s.sellIdr)} hint={`${s.bookings} booking`} />
            <Stat label="Modal (diketahui)" value={formatRupiah(s.costKnownIdr)} hint={s.costCoveragePct != null ? `cakupan modal ${s.costCoveragePct.toFixed(1)}%` : undefined} />
            <Stat label="Untung" value={formatRupiah(s.profitIdr)} tone={s.profitIdr < 0 ? 'danger' : 'ok'} hint={s.marginPct != null ? `${s.marginPct.toFixed(1)}% dari penjualan bermodal` : 'belum ada baris bermodal'} />
            <Stat label="Terealisasi" value={formatRupiah(s.realizedSellIdr)} hint={`untung ${formatRupiah(s.realizedProfitIdr)} · dibayar ${formatRupiah(s.paidIdr)}`} />
          </div>
          {s.sellUnknownCostIdr > 0 && (
            <p className="m-0 rounded-xl border border-admin-gold/40 bg-admin-gold/10 px-3 py-2 text-xs text-admin-ink">
              {formatRupiah(s.sellUnknownCostIdr)} penjualan belum diketahui modalnya, sehingga untungnya tidak termasuk di atas (modal kosong di editor produk, atau data pesanan lama).
            </p>
          )}
          {s.lossBookings > 0 && (
            <p className="m-0 rounded-xl border border-admin-danger/30 bg-admin-danger/5 px-3 py-2 text-xs text-admin-ink">
              {s.lossBookings} pesanan di bawah HPP (untung teridentifikasi negatif — mis. diskon melampaui margin).{' '}
              <button type="button" className="font-semibold underline" onClick={() => go({ loss: onlyLoss ? '0' : '1', page: '1' })}>{onlyLoss ? 'Tampilkan semua pesanan' : 'Tampilkan hanya yang rugi'}</button>
            </p>
          )}
          {data.cancelledRetained.bookings > 0 && (
            <p className="m-0 text-xs text-admin-muted">
              Ditahan dari {data.cancelledRetained.bookings} pesanan yang dibatalkan: <span className="font-semibold tabular-nums text-admin-ink">{formatRupiah(data.cancelledRetained.retainedIdr)}</span> (dibayar − refund) — tidak masuk penjualan/untung di atas.
            </p>
          )}
        </>
      )}

      {data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="space-y-2 p-4">
            <h2 className="m-0 text-sm font-bold">Per produk</h2>
            <DataTable
              columns={[{ key: 'p', header: 'Produk', mobile: 'title', cell: (r: Report['byProduct'][number]) => <span className="font-semibold text-admin-ink">{ITEM_LABEL[r.itemType] ?? r.itemType}</span> }, ...figureColumns<Report['byProduct'][number]>()]}
              rows={data.byProduct} getRowId={r => r.itemType} loading={loading} empty="Belum ada penjualan pada periode ini."
            />
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="m-0 text-sm font-bold">Per vendor</h2>
            <DataTable
              columns={[{ key: 'v', header: 'Vendor', mobile: 'title', cell: (r: Report['byVendor'][number]) => <span className={cn('font-semibold', r.kind === 'vendor' ? 'text-admin-ink' : 'text-admin-muted')}>{r.label}</span> }, ...figureColumns<Report['byVendor'][number]>()]}
              rows={data.byVendor} getRowId={r => r.label} loading={loading} empty="Belum ada penjualan pada periode ini."
            />
          </Card>
          <Card className="space-y-2 p-4 lg:col-span-2">
            <h2 className="m-0 text-sm font-bold">Per bulan</h2>
            <DataTable
              columns={[{ key: 'm', header: 'Bulan', mobile: 'title', cell: (r: Report['byMonth'][number]) => <span className="font-semibold text-admin-ink">{r.month}</span> }, ...figureColumns<Report['byMonth'][number]>(),
                { key: 'real', header: 'Terealisasi', align: 'right', hideBelowLg: true, cell: r => <Rp v={r.realizedSellIdr} /> }]}
              rows={data.byMonth} getRowId={r => r.month} loading={loading} empty="Belum ada penjualan pada periode ini."
            />
          </Card>
        </div>
      )}

      <Card className="space-y-2 p-4">
        <h2 className="m-0 text-sm font-bold">Per booking</h2>
        <DataTable
          columns={bookingColumns} rows={data?.bookings ?? []} getRowId={r => r.id} loading={loading}
          empty="Tidak ada booking pada periode ini."
          footer={meta ? <Pagination {...meta} onPageChange={setPage} /> : undefined}
        />
      </Card>
    </div>
  )
}
