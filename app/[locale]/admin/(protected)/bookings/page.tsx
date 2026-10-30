import Link from 'next/link'
import { Plus } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { formatRupiah } from '@/lib/utils'
import { escapeLike } from '@/lib/utils/search'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { displayStatusOf, isStatusFilter, statusSelect, statusWhere } from '@/lib/booking/lifecycle'
import { BOOKING_TONE } from '@/lib/admin/statusTone'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { SearchForm } from '@/components/admin/data-table/SearchForm'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { formatCalendarDate } from '@/lib/time'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type BookingRow = Prisma.BookingGetPayload<{
  include: { user: { select: { fullName: true; phone: true } }; _count: { select: { pilgrims: true } }; payments: { select: { id: true } } }
}>

export default async function AdminBookings({ params, searchParams }: Props) {
  const { locale } = await params
  await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)
  const rawStatus = typeof sp.status === 'string' ? sp.status : undefined
  const status = isStatusFilter(rawStatus) ? rawStatus : undefined
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100)

  const where: Prisma.BookingWhereInput = {
    ...(status ? statusWhere(status) : {}),
    // AND, bukan OR di akar: filter status `confirmed` membawa OR sendiri
    AND: q ? [{ OR: [
      { bookingCode: { contains: escapeLike(q), mode: 'insensitive' } },
      { user: { fullName: { contains: escapeLike(q), mode: 'insensitive' } } },
    ] }] : undefined,
  }

  const { items: bookings, meta } = await paginate<BookingRow>(
    list,
    () => prisma.booking.count({ where }),
    range => prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // id = tie-breaker: createdAt bisa kembar, halaman harus stabil
      ...range,
      include: { user: { select: { fullName: true, phone: true } }, _count: { select: { pilgrims: true } }, payments: statusSelect.payments },
    }),
  )

  const base = `/${locale}/admin/bookings`
  const hrefFor = (over: Record<string, string | number | undefined>) =>
    buildListHref(base, { status, q, limit: sp.limit === undefined ? undefined : list.limit, ...over })

  const columns: Column<BookingRow>[] = [
    {
      key: 'code', header: 'Kode', mobile: 'title',
      cell: b => (
        <Link href={`/${locale}/admin/bookings/${b.id}`} className="font-mono text-[12px] font-semibold text-admin-accent hover:text-admin-accent-strong">
          {b.bookingCode}
        </Link>
      ),
    },
    {
      key: 'pilgrim', header: 'Jamaah',
      cell: b => (
        <>
          <div className="text-[13px] font-medium">{b.user.fullName ?? '-'}</div>
          <div className="text-[11px] text-admin-muted">{b._count.pilgrims} jamaah</div>
        </>
      ),
    },
    {
      key: 'departure', header: 'Berangkat',
      cell: b => <span className="text-[12px] text-admin-muted">{b.departureDate ? formatCalendarDate(b.departureDate) : 'Belum ada tanggal'}</span>,
    },
    {
      key: 'total', header: 'Total', hideBelowLg: true,
      cell: b => <span className="text-[12px] font-medium tabular-nums">{formatRupiah(Number(b.totalAmount))}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: b => { const st = displayStatusOf(b); return <Badge tone={BOOKING_TONE[st] ?? 'neutral'}>{BOOKING_STATUS[st].label}</Badge> },
    },
    {
      key: 'actions', header: '', actions: true,
      cell: b => <RowActions><ActionLink kind="view" href={`/${locale}/admin/bookings/${b.id}`} label={`Lihat booking ${b.bookingCode}`} /></RowActions>,
    },
  ]

  const limitParam = sp.limit === undefined ? undefined : String(list.limit)
  const navQuery = { q: q || undefined, status, limit: limitParam }

  return (
    <div className="space-y-5">
      <PageHeader title="Daftar Booking" description="Cari berdasarkan kode booking atau nama pemesan."
        actions={<Link href={`/${locale}/admin/bookings/new`} className="admin-btn"><Plus className="h-4 w-4" /> Booking Baru</Link>} />

      <FilterBar active={Boolean(q || status)} resetHref={buildListHref(base, { limit: limitParam })}>
        <SearchForm
          action={base} q={q} placeholder="Cari kode booking / nama…"
          preserve={{ status, limit: limitParam }}
          clearHref={hrefFor({ q: undefined, page: 1 })}
        />
        <FilterSelect label="Status" value={status ?? ''} options={Object.entries(BOOKING_STATUS).map(([value, v]) => ({ value, label: v.label }))} nav={{ base, param: 'status', query: navQuery }} />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={bookings}
        getRowId={b => b.id}
        empty="Tidak ada booking ditemukan."
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined}
      />
    </div>
  )
}
