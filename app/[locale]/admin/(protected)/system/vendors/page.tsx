import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, Tags } from 'lucide-react'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { COUNTRIES, getCountryName } from '@/lib/constants/countries'
import { VENDOR_CATEGORY_SLUGS } from '@/lib/constants/vendor'
import { countVendors, listCategories, listVendors, type VendorListQuery } from '@/lib/vendors/service'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { ApiAction } from '@/components/admin/data-table/ApiAction'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { SearchForm } from '@/components/admin/data-table/SearchForm'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type VendorRow = Awaited<ReturnType<typeof listVendors>>[number]

const STATUS_OPTIONS = [{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]
const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

/** Vendor yang belum dikategorikan dengan benar: tanpa kategori, atau hanya "Lainnya" (hasil pemetaan migrasi data lama). */
const needsReview = (v: VendorRow) =>
  v.categories.length === 0 || (v.categories.length === 1 && v.categories[0]?.slug === VENDOR_CATEGORY_SLUGS.other)

export default async function VendorsPage({ params, searchParams }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)

  const sp = await searchParams
  const list = parseListParams(sp)
  const q = (str(sp.q) ?? '').trim().slice(0, 100)
  const categories = await listCategories()
  const category = categories.some(c => c.slug === str(sp.category)) ? str(sp.category) : undefined
  const country = COUNTRIES.some(c => c.code === str(sp.country)) ? str(sp.country) : undefined
  const status = str(sp.status) === 'active' || str(sp.status) === 'inactive' ? (str(sp.status) as 'active' | 'inactive') : undefined
  const filters: Omit<VendorListQuery, 'skip' | 'take'> = { q: q || undefined, category, country, status }

  const { items: vendors, meta } = await paginate(
    list,
    () => countVendors(filters),
    range => listVendors({ ...filters, ...range }),
  )

  const base = `/${locale}/admin/system/vendors`
  const limitParam = sp.limit === undefined ? undefined : list.limit
  const hrefFor = (over: Record<string, string | number | undefined>) =>
    buildListHref(base, { q, category, country, status, limit: limitParam, ...over })

  const columns: Column<VendorRow>[] = [
    {
      key: 'name', header: 'Vendor', mobile: 'title',
      cell: v => (
        <Link href={`${base}/${v.id}`} className="text-[13px] font-semibold text-admin-accent hover:text-admin-accent-strong">{v.name}</Link>
      ),
    },
    {
      key: 'country', header: 'Negara',
      cell: v => <span className="text-[12px]">{getCountryName(v.countryCode) ?? v.countryCode}</span>,
    },
    {
      key: 'categories', header: 'Kategori',
      cell: v => (
        <div className="flex flex-wrap gap-1">
          {v.categories.map(c => <Badge key={c.id} tone={c.isActive ? 'accent' : 'neutral'}>{c.name}</Badge>)}
        </div>
      ),
    },
    {
      key: 'contact', header: 'Kontak', hideBelowLg: true,
      cell: v => (
        <>
          <div className="text-[12px]">{v.contactName ?? '-'}</div>
          <div className="text-[11px] text-admin-muted">{v.phone ? `+${COUNTRIES.find(c => c.code === v.phoneCountryCode)?.dialCode ?? ''} ${v.phone}` : (v.email ?? '')}</div>
        </>
      ),
    },
    {
      key: 'status', header: 'Status',
      cell: v => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={v.isActive ? 'ok' : 'neutral'}>{v.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
          {v.systemKey && <Badge tone="accent">Sistem</Badge>}
          {needsReview(v) && <Badge tone="warning">Perlu ditinjau</Badge>}
        </div>
      ),
    },
    {
      key: 'actions', header: '', actions: true,
      cell: v => (
        <RowActions>
          <ActionLink kind="edit" href={`${base}/${v.id}`} label={`Edit vendor ${v.name}`} />
          {/* vendor sistem tak pernah dihapus/dinonaktifkan (lib/vendors/service.ts) */}
          {!v.systemKey && <ApiAction kind="toggle" url={`/api/v1/admin/system/vendors/${v.id}`} active={v.isActive} label={`${v.isActive ? 'Nonaktifkan' : 'Aktifkan'} vendor ${v.name}`} />}
          {!v.systemKey && <ApiAction kind="delete" url={`/api/v1/admin/system/vendors/${v.id}`} subject={`vendor ${v.name}`} note="Vendor yang masih dirujuk harga/biaya akan dinonaktifkan, bukan dihapus." />}
        </RowActions>
      ),
    },
  ]

  const navQuery = { q: q || undefined, category, country, status, limit: limitParam === undefined ? undefined : String(limitParam) }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vendor"
        description="Satu daftar vendor untuk semua modul — hotel, maskapai, transport, visa, katering, dan lainnya."
        actions={
          <>
            <Link href={`${base}/categories`}><Button variant="outline"><Tags className="size-4" /> Kategori</Button></Link>
            <Link href={`${base}/new`}><Button><Plus className="size-4" /> Vendor baru</Button></Link>
          </>
        }
      />

      <FilterBar active={Boolean(q || category || country || status)} resetHref={buildListHref(base, { limit: limitParam })}>
        <SearchForm
          action={base} q={q} placeholder="Cari nama vendor / PIC / email…"
          preserve={{ category, country, status, limit: limitParam === undefined ? undefined : String(limitParam) }}
          clearHref={hrefFor({ q: undefined, page: 1 })}
        />
        <FilterSelect label="Kategori" value={category ?? ''} options={categories.filter(c => c.isActive || c.slug === category).map(c => ({ value: c.slug, label: c.name }))} nav={{ base, param: 'category', query: navQuery }} />
        <FilterSelect label="Negara" value={country ?? ''} options={COUNTRIES.map(c => ({ value: c.code, label: c.name }))} nav={{ base, param: 'country', query: navQuery }} />
        <FilterSelect label="Status" value={status ?? ''} options={STATUS_OPTIONS} nav={{ base, param: 'status', query: navQuery }} />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={vendors}
        getRowId={v => v.id}
        rowClassName={v => (v.isActive ? undefined : 'opacity-60')}
        empty="Tidak ada vendor ditemukan."
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined}
      />
    </div>
  )
}
