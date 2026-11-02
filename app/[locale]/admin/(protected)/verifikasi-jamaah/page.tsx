import Link from 'next/link'
import type { PilgrimReviewStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { escapeLike } from '@/lib/utils/search'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { SearchForm } from '@/components/admin/data-table/SearchForm'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { REVIEW_LABEL } from '@/lib/pilgrims/reviewState'
import { DATETIME_LONG, formatInstant } from '@/lib/time'

// Antrean pemeriksaan data jamaah (docs/arsitektur-jamaah.md §8.4 butir 7, Fase 6): jamaah booking AKTIF per status pengajuan, bawaan
// "Menunggu pemeriksaan" (terlama dulu). Pemeriksaan dilakukan di halaman booking. Kolom tersegel tak pernah dimuat (select eksplisit).
type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const STATUSES = ['submitted', 'needs_revision', 'verified', 'draft'] as const satisfies readonly PilgrimReviewStatus[]
const TONE: Record<PilgrimReviewStatus, BadgeTone> = { draft: 'neutral', submitted: 'warning', needs_revision: 'danger', verified: 'ok' }

const rowSelect = {
  id: true, reviewStatus: true, submittedAt: true, verifiedAt: true,
  savedPilgrim: { select: { fullName: true } },
  booking: { select: { id: true, bookingCode: true, user: { select: { fullName: true } } } },
} satisfies Prisma.BookingPilgrimSelect
type Row = Prisma.BookingPilgrimGetPayload<{ select: typeof rowSelect }>

export default async function PilgrimReviewQueue({ params, searchParams }: Props) {
  const { locale } = await params
  await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100)
  const status: PilgrimReviewStatus = (STATUSES as readonly string[]).includes(sp.status as string) ? (sp.status as PilgrimReviewStatus) : 'submitted'

  const where: Prisma.BookingPilgrimWhereInput = {
    reviewStatus: status,
    booking: {
      status: 'active',
      ...(q ? { OR: [{ bookingCode: { contains: escapeLike(q), mode: 'insensitive' } }, { user: { fullName: { contains: escapeLike(q), mode: 'insensitive' } } }] } : {}),
    },
  }
  const { items, meta } = await paginate<Row>(
    list,
    () => prisma.bookingPilgrim.count({ where }),
    range => prisma.bookingPilgrim.findMany({
      where,
      // Terlama diajukan dulu (antrean); draf belum punya submittedAt → urut id. id = tie-breaker supaya halaman stabil.
      orderBy: [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      ...range,
      select: rowSelect,
    }),
  )

  const base = `/${locale}/admin/verifikasi-jamaah`
  const limitParam = sp.limit === undefined ? undefined : list.limit
  const statusParam = status === 'submitted' ? undefined : status
  const hrefFor = (over: Record<string, string | number | undefined>) => buildListHref(base, { q: q || undefined, status: statusParam, limit: limitParam, ...over })

  const columns: Column<Row>[] = [
    {
      key: 'pilgrim', header: 'Jamaah', mobile: 'title',
      cell: r => (
        <>
          <span className="text-[13px] font-semibold text-admin-ink">{r.savedPilgrim?.fullName ?? 'Jamaah (tanpa data tersimpan)'}</span>
          <div className="text-[12px] text-admin-muted">Pemesan: {r.booking.user.fullName}</div>
        </>
      ),
    },
    {
      key: 'booking', header: 'Booking',
      cell: r => <Link href={`/${locale}/admin/bookings/${r.booking.id}`} className="font-mono text-[12px] font-semibold text-admin-accent hover:text-admin-accent-strong">{r.booking.bookingCode}</Link>,
    },
    { key: 'status', header: 'Status', cell: r => <Badge tone={TONE[r.reviewStatus]}>{REVIEW_LABEL[r.reviewStatus]}</Badge> },
    {
      key: 'at', header: 'Diajukan', hideBelowLg: true,
      cell: r => <span className="text-[12px] text-admin-muted">{r.submittedAt ? formatInstant(r.submittedAt, DATETIME_LONG) : '-'}</span>,
    },
    {
      key: 'actions', header: '', actions: true,
      cell: r => <RowActions><ActionLink kind="view" href={`/${locale}/admin/bookings/${r.booking.id}`} label={`Periksa jamaah booking ${r.booking.bookingCode}`} /></RowActions>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Verifikasi Jamaah" description={`${meta.total} jamaah — ${REVIEW_LABEL[status].toLowerCase()}`} />

      <FilterBar active={Boolean(q || statusParam)} resetHref={buildListHref(base, { limit: limitParam })}>
        <SearchForm action={base} q={q} placeholder="Cari kode booking / nama pemesan…" preserve={{ status: statusParam, limit: limitParam === undefined ? undefined : String(limitParam) }} clearHref={hrefFor({ q: undefined, page: 1 })} />
        <FilterSelect label="Status" allLabel={REVIEW_LABEL.submitted} value={statusParam ?? ''} options={STATUSES.filter(s => s !== 'submitted').map(s => ({ value: s, label: REVIEW_LABEL[s] }))}
          nav={{ base, param: 'status', query: { q: q || undefined, limit: limitParam === undefined ? undefined : String(limitParam) } }} />
      </FilterBar>

      <DataTable
        columns={columns} rows={items} getRowId={r => r.id} empty="Tidak ada jamaah pada status ini."
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined}
      />
    </div>
  )
}
