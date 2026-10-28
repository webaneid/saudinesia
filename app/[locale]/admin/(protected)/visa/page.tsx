import Link from 'next/link'
import type { Prisma, VisaStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { VISA_STATUS, VISA_TYPE_LABEL } from '@/lib/constants/booking'
import { getManifestFieldRequirements, getFieldByRole } from '@/lib/manifest/getRequirements'
import { VISA_TONE } from '@/lib/admin/statusTone'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { SearchForm } from '@/components/admin/data-table/SearchForm'
import { escapeLike } from '@/lib/utils/search'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { requireAdminPage } from '@/lib/auth/pageGuards'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type VisaRow = Prisma.VisaApplicationGetPayload<{
  include: { pilgrim: { include: { booking: { select: { bookingCode: true; id: true } }; documents: { select: { docType: true } } } } }
}>

// hasOwnProperty, bukan `in` — `in` meloloskan "toString"/"constructor" dari prototype.
const isVisaStatus = (v: string | undefined): v is VisaStatus =>
  !!v && Object.prototype.hasOwnProperty.call(VISA_STATUS, v)

export default async function AdminVisa({ params, searchParams }: Props) {
  const { locale } = await params
  await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)
  const rawStatus = typeof sp.status === 'string' ? sp.status : undefined
  const status = isVisaStatus(rawStatus) ? rawStatus : undefined

  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100)
  const where: Prisma.VisaApplicationWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { pilgrim: { booking: { bookingCode: { contains: escapeLike(q), mode: 'insensitive' } } } } : {}),
  }

  const { items: applications, meta } = await paginate<VisaRow>(
    list,
    () => prisma.visaApplication.count({ where }),
    range => prisma.visaApplication.findMany({
      where,
      // VisaApplication tak punya createdAt; id (UUID) hanya tie-breaker agar halaman stabil.
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      ...range,
      include: {
        pilgrim: {
          include: {
            booking:   { select: { bookingCode: true, id: true } },
            documents: { select: { docType: true } },
          },
        },
      },
    }),
  )

  // docs/arsitektur-manifest.md §4 — getFieldByRole() menggantikan a.pilgrim.fullName (kolom
  // baku sudah dihapus). Dicache per visaProductId, bukan per aplikasi, biar tidak fetch dobel.
  const fieldsByProduct = new Map<string, Awaited<ReturnType<typeof getManifestFieldRequirements>>>()
  for (const productId of new Set(applications.map(a => a.visaProductId).filter((v): v is string => !!v))) {
    fieldsByProduct.set(productId, await getManifestFieldRequirements('visa', productId))
  }
  function displayName(a: VisaRow): string {
    const fields = a.visaProductId ? fieldsByProduct.get(a.visaProductId) ?? [] : []
    const name = getFieldByRole(fields, a.pilgrim.fieldValues as Record<string, unknown>, 'display_name')
    return typeof name === 'string' && name ? name : 'Jamaah'
  }

  const base = `/${locale}/admin/visa`
  const limitParam = sp.limit === undefined ? undefined : list.limit
  const hrefFor = (over: Record<string, string | number | undefined>) =>
    buildListHref(base, { q: q || undefined, status, limit: limitParam, ...over })

  const columns: Column<VisaRow>[] = [
    { key: 'name', header: 'Jamaah', mobile: 'title', cell: a => <span className="text-[13px] font-medium">{displayName(a)}</span> },
    {
      key: 'booking', header: 'Booking',
      cell: a => (
        <Link href={`/${locale}/admin/bookings/${a.pilgrim.booking.id}`} className="font-mono text-[12px] font-semibold text-admin-accent hover:text-admin-accent-strong">
          {a.pilgrim.booking.bookingCode}
        </Link>
      ),
    },
    { key: 'type', header: 'Jenis Visa', cell: a => <span className="text-[12px] text-admin-muted">{VISA_TYPE_LABEL[a.visaType] ?? a.visaType}</span> },
    { key: 'docs', header: 'Dokumen', cell: a => <span className="text-[12px] text-admin-muted">{a.pilgrim.documents.length} file</span> },
    {
      key: 'status', header: 'Status',
      cell: a => <Badge tone={VISA_TONE[a.status] ?? 'neutral'}>{VISA_STATUS[a.status as keyof typeof VISA_STATUS]?.label ?? a.status}</Badge>,
    },
    {
      key: 'actions', header: '', actions: true,
      cell: a => <RowActions><ActionLink kind="view" href={`/${locale}/admin/bookings/${a.pilgrim.booking.id}`} label={`Kelola visa booking ${a.pilgrim.booking.bookingCode}`} /></RowActions>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Manajemen Visa" description="Cari berdasarkan kode booking." />

      <FilterBar active={Boolean(q || status)} resetHref={buildListHref(base, { limit: limitParam })}>
        <SearchForm action={base} q={q} placeholder="Cari kode booking…" preserve={{ status, limit: limitParam === undefined ? undefined : String(limitParam) }} clearHref={hrefFor({ q: undefined, page: 1 })} />
        <FilterSelect label="Status" value={status ?? ''} options={Object.entries(VISA_STATUS).map(([value, v]) => ({ value, label: v.label }))} nav={{ base, param: 'status', query: { q: q || undefined, limit: limitParam === undefined ? undefined : String(limitParam) } }} />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={applications}
        getRowId={a => a.id}
        empty="Tidak ada data."
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined}
      />
    </div>
  )
}
