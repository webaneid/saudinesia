import { redirect } from 'next/navigation'
import { Download } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { DATE_SHORT_MONTH, formatInstant, yearInApp } from '@/lib/time'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { safeLocale } from '@/lib/utils/locale'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { buildListHref, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { Card } from '@/components/admin/ui/Card'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { SearchForm } from '@/components/admin/data-table/SearchForm'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { REVENUE_SHARE_BASIS_LABEL } from '@/lib/revenue-share/example'
import { bookingIncome, firstIncomeYear, INCOME_STATUSES, isIncomeStatus, monthlyIncome, type BookingIncomeRow, type IncomeStatus, type MonthRow } from '@/lib/revenue-share/income'
import { adminHref } from '@/lib/admin/href'

// Pendapatan Platform Provider (Fase 13e-2, docs/arsitektur-bagi-hasil.md §5e): ringkasan per bulan satu tahun (zona aplikasi) + potensi vs hak per booking,
// keduanya bisa diekspor CSV. Superadmin (termasuk akun Platform Provider) — rincian bagi hasil internal. Tanpa data pribadi (hanya kode booking/invoice).
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

const STATUS: Record<IncomeStatus, { label: string; tone: 'ok' | 'neutral' | 'warning' | 'danger' }> = {
  active: { label: 'Aktif', tone: 'warning' }, completed: { label: 'Selesai', tone: 'ok' }, cancelled: { label: 'Dibatalkan', tone: 'neutral' }, expired: { label: 'Hangus', tone: 'neutral' },
}
const MONTH = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'] as const
const pct = (n: number) => `${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`

export default async function RevenueShareIncome({ params, searchParams }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(adminHref(safeLocale(locale), '/admin'))
  const sp = await searchParams
  const thisYear = yearInApp()
  const first = await firstIncomeYear()
  const firstYear = Math.min(thisYear, first ? yearInApp(first) : thisYear)
  const yearRaw = typeof sp.year === 'string' && /^\d{4}$/.test(sp.year) ? Number(sp.year) : thisYear
  const year = yearRaw >= firstYear && yearRaw <= thisYear ? yearRaw : thisYear
  const status = isIncomeStatus(sp.status) ? sp.status : undefined
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 60) : ''
  const list = parseListParams(sp)
  const [summary, { items, meta }] = await Promise.all([monthlyIncome(year), bookingIncome({ status, q: q || undefined }, list)])

  const base = adminHref(locale, `/admin/system/platform-provider/income`)
  const limitParam = sp.limit === undefined ? undefined : list.limit
  const keep = { year: year === thisYear ? undefined : String(year), status, q: q || undefined, limit: limitParam === undefined ? undefined : String(limitParam) }
  const hrefFor = (over: Record<string, string | number | undefined>) => buildListHref(base, { ...keep, ...over })
  const exportApi = '/api/v1/admin/system/platform-provider/income/export'

  const monthCols: Column<MonthRow>[] = [
    { key: 'm', header: 'Bulan', mobile: 'title', cell: r => <span className="text-[12px]">{MONTH[Number(r.month.slice(5)) - 1]} {r.month.slice(0, 4)}</span> },
    { key: 'in', header: 'Hak masuk', align: 'right', cell: r => <span className={`text-[12px] tabular-nums ${r.entitledIdr < 0 ? 'text-admin-danger' : ''}`}>{formatRupiah(r.entitledIdr)}</span> },
    { key: 'out', header: 'Dicairkan', align: 'right', cell: r => <span className="text-[12px] tabular-nums">{formatRupiah(r.paidOutIdr)}</span> },
    { key: 'bal', header: 'Saldo akhir', align: 'right', cell: r => <span className="text-[12px] font-semibold tabular-nums">{formatRupiah(r.balanceEndIdr)}</span> },
  ]
  const bookingCols: Column<BookingIncomeRow>[] = [
    { key: 'code', header: 'Booking', mobile: 'title', cell: r => <span className="text-[12px] font-medium text-admin-ink">{r.bookingCode}<span className="block text-[11px] font-normal text-admin-muted">{r.invoiceNumber}</span></span> },
    { key: 'at', header: 'Terbit', hideBelowLg: true, cell: r => <span className="text-[12px] tabular-nums">{r.issuedAt ? formatInstant(r.issuedAt, DATE_SHORT_MONTH) : '—'}</span> },
    { key: 'st', header: 'Status', cell: r => isIncomeStatus(r.status) ? <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> : <span className="text-[12px]">{r.status}</span> },
    { key: 'rule', header: 'Aturan', hideBelowLg: true, cell: r => <span className="text-[12px] text-admin-muted">{r.rule ? `${pct(r.rule.percent)} · ${REVENUE_SHARE_BASIS_LABEL[r.rule.basis]}` : '—'}</span> },
    { key: 'pot', header: 'Potensi', align: 'right', cell: r => <span className="text-[12px] tabular-nums">{formatRupiah(r.potentialIdr)}{r.final && <span className="block text-[11px] text-admin-muted">akhir</span>}</span> },
    { key: 'hak', header: 'Hak', align: 'right', cell: r => <span className="text-[12px] font-semibold tabular-nums">{formatRupiah(r.entitledIdr)}{r.entitledPct !== null && <span className="block text-[11px] font-normal text-admin-muted">{pct(r.entitledPct)}</span>}</span> },
    { key: 'actions', header: '', actions: true, cell: r => <RowActions><ActionLink kind="view" href={adminHref(locale, `/admin/bookings/${r.bookingId}`)} label={`Buka booking ${r.bookingCode}`} /></RowActions> },
  ]
  const yearOptions = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => String(thisYear - i)).map(y => ({ value: y, label: y }))

  return (
    <div className="space-y-5">
      <PageHeader title="Pendapatan Platform Provider" description="Hak bagi hasil dari pembayaran berhasil, pencairan, dan saldo per bulan (zona waktu aplikasi); potensi vs hak per booking." />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <FilterBar active={year !== thisYear} resetHref={hrefFor({ year: undefined, page: undefined })}>
            <FilterSelect label="Tahun" value={String(year)} options={yearOptions} nav={{ base, param: 'year', query: { status, q: q || undefined, limit: keep.limit } }} />
          </FilterBar>
          <a href={`${exportApi}?kind=monthly&year=${year}`} className="admin-btn-sm"><Download className="size-4" /> CSV bulanan</a>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Card><p className="m-0 text-[11px] text-admin-muted">Saldo awal {year}</p><p className="m-0 text-lg font-semibold tabular-nums text-admin-ink">{formatRupiah(summary.openingIdr)}</p></Card>
          <Card><p className="m-0 text-[11px] text-admin-muted">Hak masuk {year}</p><p className="m-0 text-lg font-semibold tabular-nums text-admin-ink">{formatRupiah(summary.entitledIdr)}</p></Card>
          <Card><p className="m-0 text-[11px] text-admin-muted">Dicairkan {year}</p><p className="m-0 text-lg font-semibold tabular-nums text-admin-ink">{formatRupiah(summary.paidOutIdr)}</p></Card>
          <Card><p className="m-0 text-[11px] text-admin-muted">Saldo akhir {year}</p><p className="m-0 text-lg font-semibold tabular-nums text-admin-ink">{formatRupiah(summary.closingIdr)}</p></Card>
        </div>
        <DataTable columns={monthCols} rows={summary.months} getRowId={r => r.month} empty="Tidak ada data." />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="m-0 text-sm font-bold text-admin-ink">Per booking</h2>
          <a href={`${exportApi}?kind=bookings${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="admin-btn-sm"><Download className="size-4" /> CSV per booking</a>
        </div>
        <FilterBar active={Boolean(status || q)} resetHref={hrefFor({ status: undefined, q: undefined, page: undefined })}>
          <SearchForm action={base} q={q} placeholder="Cari kode booking…" preserve={{ year: keep.year, status, limit: keep.limit }} clearHref={hrefFor({ q: undefined, page: undefined })} />
          <FilterSelect label="Status" value={status ?? ''} options={INCOME_STATUSES.map(s => ({ value: s, label: STATUS[s].label }))} nav={{ base, param: 'status', query: { year: keep.year, q: q || undefined, limit: keep.limit } }} />
        </FilterBar>
        <DataTable columns={bookingCols} rows={items} getRowId={r => r.bookingId} empty="Belum ada booking dengan bagi hasil." footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined} />
      </section>
    </div>
  )
}
