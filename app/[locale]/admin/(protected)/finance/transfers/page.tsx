import Link from 'next/link'
import { Plus } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'
import { buildListHref, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { canTransferCash } from '@/lib/pricing/policy'
import { listTransfers, type TransferRow } from '@/lib/cash/transfers'
import { adminHref } from '@/lib/admin/href'

// Transfer antar akun kas (docs/arsitektur-booking-engine-v2.md §10.14 Fase 12b): daftar untuk semua admin; catat & batalkan oleh manager + superadmin (K12-1).
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

const STATUS = { active: 'Berlaku', void: 'Dibatalkan' } as const

export default async function CashTransfers({ params, searchParams }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)
  const status = sp.status === 'active' || sp.status === 'void' ? sp.status : undefined
  const { items, meta } = await listTransfers({ status }, list)

  const base = adminHref(locale, `/admin/finance/transfers`)
  const limitParam = sp.limit === undefined ? undefined : list.limit
  const hrefFor = (over: Record<string, string | number | undefined>) => buildListHref(base, { status, limit: limitParam, ...over })

  const columns: Column<TransferRow>[] = [
    { key: 'at', header: 'Waktu', mobile: 'title', cell: r => <span className="text-[12px] tabular-nums">{formatInstant(r.transferredAt, DATETIME_MEDIUM)}</span> },
    { key: 'route', header: 'Dari → ke', cell: r => <span className="text-[12px] text-admin-ink">{r.from} <span className="text-admin-muted">→</span> {r.to}</span> },
    { key: 'st', header: 'Status', cell: r => <Badge tone={r.voided ? 'neutral' : 'ok'}>{r.voided ? STATUS.void : STATUS.active}</Badge> },
    { key: 'fee', header: 'Biaya', align: 'right', hideBelowLg: true, cell: r => <span className="text-[12px] tabular-nums text-admin-muted">{r.feeIdr > 0 ? formatRupiah(r.feeIdr) : '—'}</span> },
    { key: 'amt', header: 'Jumlah', align: 'right', cell: r => <span className={`text-[12px] font-semibold tabular-nums ${r.voided ? 'text-admin-muted line-through' : ''}`}>{formatRupiah(r.amountIdr)}</span> },
    { key: 'actions', header: '', actions: true, cell: r => <RowActions><ActionLink kind="view" href={`${base}/${r.id}`} label={`Buka transfer ${r.from} ke ${r.to}`} /></RowActions> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Transfer Antar Akun" description="Memindahkan saldo milik perusahaan antar akun kas (mis. iPaymu → rekening, rekening → kas tunai). Tercatat di buku kas; batal = entri pembalik."
        actions={canTransferCash(session.role) ? <Link href={`${base}/new`} className="admin-btn"><Plus className="size-4" /> Catat Transfer</Link> : undefined} />
      <FilterBar active={Boolean(status)} resetHref={buildListHref(base, { limit: limitParam })}>
        <FilterSelect label="Status" value={status ?? ''} options={(['active', 'void'] as const).map(s => ({ value: s, label: STATUS[s] }))} nav={{ base, param: 'status', query: { limit: limitParam === undefined ? undefined : String(limitParam) } }} />
      </FilterBar>
      <DataTable columns={columns} rows={items} getRowId={r => r.id} empty="Belum ada transfer antar akun." footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined} />
    </div>
  )
}
