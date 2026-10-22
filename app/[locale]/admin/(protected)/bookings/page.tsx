import Link from 'next/link'
import type { BookingStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { formatRupiah } from '@/lib/utils'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { BOOKING_TONE } from '@/lib/admin/statusTone'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterPills } from '@/components/admin/data-table/FilterPills'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { SearchForm } from '@/components/admin/data-table/SearchForm'
import { requireAdminPage } from '@/lib/auth/pageGuards'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type BookingRow = Prisma.BookingGetPayload<{
  include: { user: { select: { fullName: true; phone: true } }; _count: { select: { pilgrims: true } } }
}>

// hasOwnProperty, bukan `in` — `in` meloloskan "toString"/"constructor" dari prototype.
const isBookingStatus = (v: string | undefined): v is BookingStatus =>
  !!v && Object.prototype.hasOwnProperty.call(BOOKING_STATUS, v)

export default async function AdminBookings({ params, searchParams }: Props) {
  const { locale } = await params
  await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)
  const rawStatus = typeof sp.status === 'string' ? sp.status : undefined
  const status = isBookingStatus(rawStatus) ? rawStatus : undefined
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100)

  const where: Prisma.BookingWhereInput = {
    status,
    OR: q ? [
      { bookingCode: { contains: q, mode: 'insensitive' } },
      { user: { fullName: { contains: q, mode: 'insensitive' } } },
    ] : undefined,
  }

  const { items: bookings, meta } = await paginate<BookingRow>(
    list,
    () => prisma.booking.count({ where }),
    range => prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // id = tie-breaker: createdAt bisa kembar, halaman harus stabil
      ...range,
      include: { user: { select: { fullName: true, phone: true } }, _count: { select: { pilgrims: true } } },
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
      cell: b => <span className="text-[12px] text-admin-muted">{new Date(b.departureDate).toLocaleDateString('id-ID', { dateStyle: 'medium' })}</span>,
    },
    {
      key: 'total', header: 'Total', hideBelowLg: true,
      cell: b => <span className="text-[12px] font-medium tabular-nums">{formatRupiah(Number(b.totalAmount))}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: b => <Badge tone={BOOKING_TONE[b.status] ?? 'neutral'}>{BOOKING_STATUS[b.status as keyof typeof BOOKING_STATUS]?.label ?? b.status}</Badge>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Daftar Booking" description="Cari berdasarkan kode booking atau nama pemesan." />

      <SearchForm
        action={base}
        q={q}
        placeholder="Cari kode booking / nama…"
        preserve={{ status, limit: sp.limit === undefined ? undefined : String(list.limit) }}
        clearHref={hrefFor({ q: undefined, page: 1 })}
      />

      <FilterPills
        options={Object.entries(BOOKING_STATUS).map(([value, v]) => ({ value, label: v.label }))}
        current={status ?? ''}
        hrefFor={value => hrefFor({ status: value || undefined, page: 1 })}
      />

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
