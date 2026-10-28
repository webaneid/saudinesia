import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { requireAdminPage } from '@/lib/auth/pageGuards'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const POOL_WINDOW_DAYS = 30

type HotelQuotaRow = Prisma.HotelRoomScheduleGetPayload<{ include: { period: { include: { hotel: true } }; roomType: true } }>
type PoolRow = { date: Date; pendingCount: number; bookedCount: number }

const availTone = (avail: number) => (avail < 5 ? 'text-admin-danger' : 'text-admin-ok')

const hotelColumns = (locale: string): Column<HotelQuotaRow>[] => [
  { key: 'hotel', header: 'Hotel', mobile: 'title', cell: q => <span className="text-[13px] font-medium">{q.period.hotel.name}</span> },
  { key: 'type', header: 'Tipe', cell: q => <span className="text-[12px] capitalize text-admin-muted">{q.roomType.name}</span> },
  { key: 'total', header: 'Total', align: 'right', cell: q => <span className="tabular-nums text-admin-ink/80">{q.totalQuota}</span> },
  { key: 'pending', header: 'Pending', align: 'right', cell: q => <span className="font-medium tabular-nums text-admin-gold-strong">{q.pendingQuota}</span> },
  { key: 'booked', header: 'Booked', align: 'right', cell: q => <span className="font-medium tabular-nums text-admin-accent-strong">{q.bookedQuota}</span> },
  {
    key: 'avail', header: 'Sisa', align: 'right',
    cell: q => {
      const avail = q.totalQuota - q.pendingQuota - q.bookedQuota
      return <span className={`font-bold tabular-nums ${availTone(avail)}`}>{avail}</span>
    },
  },
  {
    key: 'actions', header: '', actions: true,
    cell: q => <RowActions><ActionLink kind="view" href={`/${locale}/admin/products/hotels/${q.period.hotel.id}`} label={`Lihat hotel ${q.period.hotel.name}`} /></RowActions>,
  },
]

export default async function AdminQuotas({ params, searchParams }: Props) {
  const { locale } = await params
  await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const windowEnd = new Date(today); windowEnd.setDate(windowEnd.getDate() + POOL_WINDOW_DAYS)

  const hotelOptions = await prisma.hotel.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true } })
  const hotelId = hotelOptions.some(h => h.id === sp.hotel) ? (sp.hotel as string) : undefined
  const scheduleWhere: Prisma.HotelRoomScheduleWhereInput = hotelId ? { period: { hotelId } } : {}

  const [hotelPage, capacitySum, poolRows] = await Promise.all([
    paginate<HotelQuotaRow>(
      list,
      () => prisma.hotelRoomSchedule.count({ where: scheduleWhere }),
      range => prisma.hotelRoomSchedule.findMany({
        where: scheduleWhere,
        include: { period: { include: { hotel: true } }, roomType: true },
        // id = tie-breaker: banyak jadwal berbagi periodStart yang sama, halaman harus stabil
        orderBy: [{ period: { periodStart: 'asc' } }, { id: 'asc' }],
        ...range,
      }),
    ),
    // Kapasitas pool = SUM live dailyCapacity muthowif aktif (docs/arsitektur-muthowif.md §9.2)
    prisma.muthowif.aggregate({ where: { isActive: true }, _sum: { dailyCapacity: true } }),
    prisma.muthowifPoolAvailability.findMany({
      where: { date: { gte: today, lte: windowEnd } },
      orderBy: { date: 'asc' },
    }),
  ])
  const { items: hotels, meta } = hotelPage

  const totalCapacity = capacitySum._sum.dailyCapacity ?? 0
  const poolByDate = new Map(poolRows.map(p => [p.date.toISOString().slice(0, 10), p]))
  const muthowifPool: PoolRow[] = Array.from({ length: POOL_WINDOW_DAYS + 1 }, (_, i) => {
    const date = new Date(today); date.setDate(date.getDate() + i)
    const key = date.toISOString().slice(0, 10)
    const row = poolByDate.get(key)
    return { date, pendingCount: row?.pendingCount ?? 0, bookedCount: row?.bookedCount ?? 0 }
  }).filter(r => r.pendingCount > 0 || r.bookedCount > 0)

  const poolColumns: Column<PoolRow>[] = [
    { key: 'date', header: 'Tanggal', mobile: 'title', cell: p => <span className="text-[13px] font-medium">{p.date.toLocaleDateString('id-ID', { dateStyle: 'medium' })}</span> },
    { key: 'pending', header: 'Pending', align: 'right', cell: p => <span className="font-medium tabular-nums text-admin-gold-strong">{p.pendingCount}</span> },
    { key: 'booked', header: 'Booked', align: 'right', cell: p => <span className="font-medium tabular-nums text-admin-accent-strong">{p.bookedCount}</span> },
    {
      key: 'avail', header: 'Sisa', align: 'right',
      cell: p => {
        const avail = totalCapacity - p.pendingCount - p.bookedCount
        return <span className={`font-bold tabular-nums ${availTone(avail)}`}>{avail}</span>
      },
    },
  ]

  const base = `/${locale}/admin/quotas`
  const limitParam = sp.limit === undefined ? undefined : String(list.limit)
  const hrefFor = (page: number) => buildListHref(base, { hotel: hotelId, page, limit: limitParam })

  return (
    <div className="space-y-7">
      <PageHeader title="Ketersediaan Quota" />

      {/* Hotel quota */}
      <div className="space-y-3">
        <p className="admin-section">Hotel</p>
        <FilterBar active={Boolean(hotelId)} resetHref={buildListHref(base, { limit: limitParam })}>
          <FilterSelect label="Hotel" value={hotelId ?? ''} options={hotelOptions.map(h => ({ value: h.id, label: h.name }))} nav={{ base, param: 'hotel', query: { limit: limitParam } }} />
        </FilterBar>
        <DataTable
          columns={hotelColumns(locale)}
          rows={hotels}
          getRowId={q => q.id}
          empty="Belum ada data quota."
          footer={meta.total > 0 ? <Pagination {...meta} hrefFor={hrefFor} /> : undefined}
        />
      </div>

      {/* Muthowif — pool gabungan semua muthowif aktif, bukan per-orang (docs/arsitektur-muthowif.md §9) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="admin-section">Muthowif</p>
          <p className="m-0 text-[12px] text-admin-muted">Kapasitas pool: <span className="font-semibold text-admin-ink">{totalCapacity}/hari</span></p>
        </div>
        <DataTable
          columns={poolColumns}
          rows={muthowifPool}
          getRowId={p => p.date.toISOString()}
          empty={`Belum ada reservasi dalam ${POOL_WINDOW_DAYS} hari ke depan.`}
        />
      </div>
    </div>
  )
}
