import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { safeLocale } from '@/lib/utils/locale'
import { buildListHref, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { Card } from '@/components/admin/ui/Card'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { canRecordPayout } from '@/lib/revenue-share/policy'
import { listPayouts, providerBalance, type PayoutRow } from '@/lib/revenue-share/payouts'
import { adminHref } from '@/lib/admin/href'

// Pencairan bagi hasil Platform Provider (Fase 13e-1, docs/arsitektur-bagi-hasil.md §5e): superadmin melihat; mencatat hanya superadmin klien
// (bukan akun Platform Provider — pembayar yang mencatat). Saldo = Σ hak − Σ pencairan berlaku.
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }
const STATUS = { active: 'Berlaku', void: 'Dibatalkan' } as const

export default async function RevenueSharePayouts({ params, searchParams }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(adminHref(safeLocale(locale), '/admin'))
  const sp = await searchParams
  const list = parseListParams(sp)
  const status = sp.status === 'active' || sp.status === 'void' ? sp.status : undefined
  const [{ items, meta }, balance] = await Promise.all([listPayouts({ status }, list), providerBalance()])

  const base = adminHref(locale, `/admin/system/platform-provider/payouts`)
  const limitParam = sp.limit === undefined ? undefined : list.limit
  const hrefFor = (over: Record<string, string | number | undefined>) => buildListHref(base, { status, limit: limitParam, ...over })

  const columns: Column<PayoutRow>[] = [
    { key: 'at', header: 'Waktu bayar', mobile: 'title', cell: r => <span className="text-[12px] tabular-nums">{formatInstant(r.paidAt, DATETIME_MEDIUM)}</span> },
    { key: 'route', header: 'Dari → ke', cell: r => <span className="text-[12px] text-admin-ink">{r.from} <span className="text-admin-muted">→</span> {r.to}</span> },
    { key: 'st', header: 'Status', cell: r => <Badge tone={r.voided ? 'neutral' : 'ok'}>{r.voided ? STATUS.void : STATUS.active}</Badge> },
    { key: 'amt', header: 'Jumlah', align: 'right', cell: r => <span className={`text-[12px] font-semibold tabular-nums ${r.voided ? 'text-admin-muted line-through' : ''}`}>{formatRupiah(r.amountIdr)}</span> },
    { key: 'actions', header: '', actions: true, cell: r => <RowActions><ActionLink kind="view" href={`${base}/${r.id}`} label={`Buka pencairan ${formatRupiah(r.amountIdr)}`} /></RowActions> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Pencairan Bagi Hasil" description="Uang bagi hasil yang dibayarkan ke Platform Provider. Tercatat di buku kas sebagai uang keluar; batal = entri pembalik."
        actions={canRecordPayout(session) ? <Link href={`${base}/new`} className="admin-btn"><Plus className="size-4" /> Catat Pencairan</Link> : undefined} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><p className="m-0 text-[11px] text-admin-muted">Hak tercatat</p><p className="m-0 text-lg font-semibold tabular-nums text-admin-ink">{formatRupiah(balance.entitledIdr)}</p></Card>
        <Card><p className="m-0 text-[11px] text-admin-muted">Sudah dicairkan</p><p className="m-0 text-lg font-semibold tabular-nums text-admin-ink">{formatRupiah(balance.paidOutIdr)}</p></Card>
        <Card><p className="m-0 text-[11px] text-admin-muted">Saldo belum dicairkan</p><p className="m-0 text-lg font-semibold tabular-nums text-admin-ink">{formatRupiah(balance.balanceIdr)}</p></Card>
      </div>
      <FilterBar active={Boolean(status)} resetHref={buildListHref(base, { limit: limitParam })}>
        <FilterSelect label="Status" value={status ?? ''} options={(['active', 'void'] as const).map(s => ({ value: s, label: STATUS[s] }))} nav={{ base, param: 'status', query: { limit: limitParam === undefined ? undefined : String(limitParam) } }} />
      </FilterBar>
      <DataTable columns={columns} rows={items} getRowId={r => r.id} empty="Belum ada pencairan bagi hasil." footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined} />
    </div>
  )
}
