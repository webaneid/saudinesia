import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { bookingWhere } from '@/lib/booking/lifecycle'
import { formatRupiah } from '@/lib/utils'
import { escapeLike } from '@/lib/utils/search'
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

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type QueueRow = Prisma.BookingGetPayload<{
  include: {
    user: { select: { fullName: true; phone: true } }
    payments: true
    _count: { select: { pilgrims: true } }
  }
}>

const PROOF_FILTERS = ['with', 'without'] as const

export default async function AdminPayments({ params, searchParams }: Props) {
  const { locale } = await params
  await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100)
  const proof = (PROOF_FILTERS as readonly string[]).includes(sp.proof as string) ? (sp.proof as (typeof PROOF_FILTERS)[number]) : undefined

  const where: Prisma.BookingWhereInput = {
    ...bookingWhere.payment_review, // ada pembayaran `pending` pada booking hidup yang belum dikonfirmasi
    // AND: `payments` sudah dipakai fragmen status di atas; filter bukti harus digabung, bukan menimpanya
    ...(proof ? { AND: [{ payments: proof === 'with' ? { some: { buktiTransferPath: { not: null } } } : { none: { buktiTransferPath: { not: null } } } }] } : {}),
    ...(q ? { OR: [{ bookingCode: { contains: escapeLike(q), mode: 'insensitive' } }, { user: { fullName: { contains: escapeLike(q), mode: 'insensitive' } } }] } : {}),
  }

  const { items: bookings, meta } = await paginate<QueueRow>(
    list,
    () => prisma.booking.count({ where }),
    range => prisma.booking.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // id = tie-breaker: updatedAt bisa kembar, halaman harus stabil
      ...range,
      include: {
        user:     { select: { fullName: true, phone: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count:   { select: { pilgrims: true } },
      },
    }),
  )

  const base = `/${locale}/admin/payments`
  const limitParam = sp.limit === undefined ? undefined : list.limit
  const hrefFor = (over: Record<string, string | number | undefined>) => buildListHref(base, { q: q || undefined, proof, limit: limitParam, ...over })

  const columns: Column<QueueRow>[] = [
    {
      key: 'code', header: 'Booking', mobile: 'title',
      cell: b => (
        <>
          <Link href={`/${locale}/admin/bookings/${b.id}`} className="font-mono text-[12px] font-semibold text-admin-accent hover:text-admin-accent-strong">{b.bookingCode}</Link>
          <div className="text-[12px] text-admin-muted">{b.user.fullName}</div>
        </>
      ),
    },
    { key: 'pilgrims', header: 'Jamaah', hideBelowLg: true, cell: b => <span className="text-[12px] text-admin-muted">{b._count.pilgrims} jamaah</span> },
    {
      key: 'proof', header: 'Bukti transfer',
      cell: b => {
        const at = b.payments[0]?.buktiTransferUploadedAt
        return at ? <span className="text-[12px] text-admin-muted">Diunggah {new Date(at).toLocaleString('id-ID')}</span> : <Badge tone="warning">Belum ada bukti</Badge>
      },
    },
    { key: 'total', header: 'Total', align: 'right', cell: b => <span className="text-[12px] font-semibold tabular-nums">{formatRupiah(Number(b.totalAmount))}</span> },
    {
      key: 'actions', header: '', actions: true,
      cell: b => <RowActions><ActionLink kind="view" href={`/${locale}/admin/bookings/${b.id}`} label={`Verifikasi pembayaran ${b.bookingCode}`} /></RowActions>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Antrean Verifikasi Pembayaran" description={`${meta.total} booking menunggu konfirmasi`} />

      <FilterBar active={Boolean(q || proof)} resetHref={buildListHref(base, { limit: limitParam })}>
        <SearchForm action={base} q={q} placeholder="Cari kode booking / nama…" preserve={{ proof, limit: limitParam === undefined ? undefined : String(limitParam) }} clearHref={hrefFor({ q: undefined, page: 1 })} />
        <FilterSelect label="Bukti" value={proof ?? ''} options={[{ value: 'with', label: 'Sudah ada bukti' }, { value: 'without', label: 'Belum ada bukti' }]} nav={{ base, param: 'proof', query: { q: q || undefined, limit: limitParam === undefined ? undefined : String(limitParam) } }} />
      </FilterBar>

      <DataTable
        columns={columns} rows={bookings} getRowId={b => b.id} empty="Tidak ada pembayaran yang perlu dikonfirmasi."
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined}
      />
    </div>
  )
}
