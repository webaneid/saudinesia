import Link from 'next/link'
import type { Prisma, RefundStatus } from '@prisma/client'
import { Plus } from 'lucide-react'
import { prisma } from '@/lib/db'
import { formatRupiah } from '@/lib/utils'
import { escapeLike } from '@/lib/utils/search'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { SearchForm } from '@/components/admin/data-table/SearchForm'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { canManageRefund } from '@/lib/pricing/policy'
import { FORCE_MAJEURE_LABEL, REFUND_SOURCE_LABEL, REFUND_STATUS as STATUS } from '@/lib/refunds/labels'

// Daftar refund (Fase 7b-2a §10.10; halaman khusus §10.13): baca untuk semua admin; Buat Refund + tindakan (setujui/bayar) di halaman detail, peran refund.
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }
type Row = Prisma.RefundGetPayload<{ include: { booking: { select: { id: true; bookingCode: true; user: { select: { fullName: true } } } } } }>

const STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const satisfies readonly RefundStatus[]

export default async function AdminRefunds({ params, searchParams }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100)
  const status = (STATUSES as readonly string[]).includes(sp.status as string) ? (sp.status as RefundStatus) : undefined

  const where: Prisma.RefundWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { booking: { OR: [{ bookingCode: { contains: escapeLike(q), mode: 'insensitive' } }, { user: { fullName: { contains: escapeLike(q), mode: 'insensitive' } } }] } } : {}),
  }
  const { items, meta } = await paginate<Row>(
    list,
    () => prisma.refund.count({ where }),
    range => prisma.refund.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...range, include: { booking: { select: { id: true, bookingCode: true, user: { select: { fullName: true } } } } } }),
  )
  const open = await prisma.refund.aggregate({ where: { status: { in: ['pending', 'approved'] } }, _sum: { amount: true }, _count: true })

  const base = `/${locale}/admin/finance/refunds`
  const limitParam = sp.limit === undefined ? undefined : list.limit
  const hrefFor = (over: Record<string, string | number | undefined>) => buildListHref(base, { q: q || undefined, status, limit: limitParam, ...over })

  const columns: Column<Row>[] = [
    {
      key: 'code', header: 'Booking', mobile: 'title',
      cell: r => (
        <>
          <Link href={`/${locale}/admin/bookings/${r.booking.id}`} className="font-mono text-[12px] font-semibold text-admin-accent hover:text-admin-accent-strong">{r.booking.bookingCode}</Link>
          <div className="text-[12px] text-admin-muted">{r.booking.user.fullName}</div>
        </>
      ),
    },
    { key: 'src', header: 'Sumber', hideBelowLg: true, cell: r => <span className="text-[12px] text-admin-muted">{REFUND_SOURCE_LABEL[r.source]}{r.forceMajeureCategory && <> <Badge tone="warning">Force-majeure · {FORCE_MAJEURE_LABEL[r.forceMajeureCategory]}</Badge></>}</span> },
    { key: 'at', header: 'Diusulkan', hideBelowLg: true, cell: r => <span className="text-[12px] tabular-nums text-admin-muted">{formatInstant(r.createdAt, DATETIME_MEDIUM)}</span> },
    { key: 'st', header: 'Status', cell: r => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
    { key: 'amt', header: 'Jumlah', align: 'right', cell: r => <span className="text-[12px] font-semibold tabular-nums">{formatRupiah(Number(r.amount))}</span> },
    { key: 'actions', header: '', actions: true, cell: r => <RowActions><ActionLink kind="view" href={`${base}/${r.id}`} label={`Buka refund ${r.booking.bookingCode}`} /></RowActions> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Refund" description={`${open._count} refund belum tuntas · ${formatRupiah(Number(open._sum.amount ?? 0))}`}
        actions={canManageRefund(session.role) ? <Link href={`${base}/new`} className="admin-btn"><Plus className="size-4" /> Buat Refund</Link> : undefined} />
      <FilterBar active={Boolean(q || status)} resetHref={buildListHref(base, { limit: limitParam })}>
        <SearchForm action={base} q={q} placeholder="Cari kode booking / nama…" preserve={{ status, limit: limitParam === undefined ? undefined : String(limitParam) }} clearHref={hrefFor({ q: undefined, page: 1 })} />
        <FilterSelect label="Status" value={status ?? ''} options={STATUSES.map(s => ({ value: s, label: STATUS[s].label }))} nav={{ base, param: 'status', query: { q: q || undefined, limit: limitParam === undefined ? undefined : String(limitParam) } }} />
      </FilterBar>
      <DataTable columns={columns} rows={items} getRowId={r => r.id} empty="Belum ada refund." footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined} />
    </div>
  )
}
