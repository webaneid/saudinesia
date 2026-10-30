import Link from 'next/link'
import { Plus, UserCheck } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { buildListHref, parseListParams } from '@/lib/admin/pagination'
import { ACTIVE_FILTERS, BOOKING_FILTERS, EMAIL_FILTERS, listCustomers, type CustomerFilters, type CustomerRow } from '@/lib/customers/query'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { SearchForm } from '@/components/admin/data-table/SearchForm'
import { formatInstant } from '@/lib/time'

// Daftar Pelanggan (docs/arsitektur-pelanggan.md): akun pemesan (role pilgrim). Semua peran admin boleh MELIHAT; mengubah status akun tetap di Sistem → Pengguna (superadmin).

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// Nilai filter dari URL divalidasi dengan daftar putih (hasOwnProperty/includes), bukan dipercaya mentah.
const pick = <T extends string>(allowed: readonly T[], v: string | string[] | undefined): T | undefined => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined)

export default async function AdminCustomers({ params, searchParams }: Props) {
  const { locale } = await params
  await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)
  const filters: CustomerFilters = {
    q: (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100),
    active: pick(ACTIVE_FILTERS, sp.active),
    email: pick(EMAIL_FILTERS, sp.email),
    bookings: pick(BOOKING_FILTERS, sp.bookings),
  }
  const { items, meta } = await listCustomers(filters, list)

  const base = `/${locale}/admin/customers`
  const hrefFor = (over: Record<string, string | number | undefined>) =>
    buildListHref(base, { q: filters.q, active: filters.active, email: filters.email, bookings: filters.bookings, limit: sp.limit === undefined ? undefined : list.limit, ...over })

  const columns: Column<CustomerRow>[] = [
    {
      key: 'name', header: 'Pelanggan', mobile: 'title',
      cell: c => c.deleted
        ? <span className="text-[13px] italic text-admin-muted">Akun dihapus</span>
        : (
          <>
            <Link href={`/${locale}/admin/customers/${c.id}`} className="text-[13px] font-medium text-admin-accent hover:text-admin-accent-strong">{c.fullName || '-'}</Link>
            <div className="text-[11px] text-admin-muted">{c.email}</div>
          </>
        ),
    },
    {
      key: 'contact', header: 'Kontak', hideBelowLg: true,
      cell: c => c.deleted ? <span className="text-admin-muted">—</span> : (
        <>
          <div className="text-[12px]">{c.phone ? `+${c.phone}` : <span className="text-admin-muted">tanpa HP</span>}</div>
          <div className="text-[11px] text-admin-muted">{c.whatsapp ? `WA +${c.whatsapp}${c.whatsappVerified ? ' (terverifikasi)' : ''}` : 'tanpa WhatsApp'}</div>
        </>
      ),
    },
    { key: 'joined', header: 'Daftar', hideBelowLg: true, cell: c => <span className="text-[12px] text-admin-muted">{formatInstant(c.createdAt)}</span> },
    { key: 'bookings', header: 'Pesanan', cell: c => <span className="text-[12px] font-medium tabular-nums">{c.bookingCount}</span> },
    { key: 'paid', header: 'Total dibayar', hideBelowLg: true, cell: c => <span className="text-[12px] font-medium tabular-nums">{formatRupiah(c.paidIdr)}</span> },
    {
      key: 'status', header: 'Status',
      cell: c => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
          {!c.emailVerified && !c.deleted && <Badge tone="warning">Belum verifikasi</Badge>}
        </div>
      ),
    },
    {
      key: 'actions', header: '', actions: true,
      cell: c => c.deleted ? null : <RowActions><ActionLink kind="view" href={`/${locale}/admin/customers/${c.id}`} label={`Lihat pelanggan ${c.fullName}`} /></RowActions>,
    },
  ]

  const navQuery = { q: filters.q || undefined, active: filters.active, email: filters.email, bookings: filters.bookings, limit: sp.limit === undefined ? undefined : String(list.limit) }
  const anyFilter = Boolean(filters.q || filters.active || filters.email || filters.bookings)

  return (
    <div className="space-y-5">
      <PageHeader
        icon={UserCheck} title="Pelanggan" description="Akun yang mendaftar dan memesan. Cari berdasarkan nama, email, atau nomor HP/WhatsApp."
        actions={<Link href={`/${locale}/admin/customers/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Pelanggan</Link>}
      />

      <FilterBar active={anyFilter} resetHref={buildListHref(base, { limit: navQuery.limit })}>
        <SearchForm
          action={base} q={filters.q ?? ''} placeholder="Cari nama / email / nomor…"
          preserve={{ active: filters.active, email: filters.email, bookings: filters.bookings, limit: navQuery.limit }}
          clearHref={hrefFor({ q: undefined, page: 1 })}
        />
        <FilterSelect label="Status" value={filters.active ?? ''} options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]} nav={{ base, param: 'active', query: navQuery }} />
        <FilterSelect label="Email" value={filters.email ?? ''} options={[{ value: 'verified', label: 'Terverifikasi' }, { value: 'unverified', label: 'Belum verifikasi' }]} nav={{ base, param: 'email', query: navQuery }} />
        <FilterSelect label="Pesanan" value={filters.bookings ?? ''} options={[{ value: 'with', label: 'Pernah memesan' }, { value: 'without', label: 'Belum pernah memesan' }]} nav={{ base, param: 'bookings', query: navQuery }} />
      </FilterBar>

      <DataTable
        columns={columns} rows={items} getRowId={c => c.id} empty="Tidak ada pelanggan ditemukan."
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined}
      />
    </div>
  )
}
