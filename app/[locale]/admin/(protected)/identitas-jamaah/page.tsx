import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { SearchForm } from '@/components/admin/data-table/SearchForm'
import { buildListHref, parseListParams } from '@/lib/admin/pagination'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { listIdentities, listUnmatchedCards, type IdentityRow, type UnmatchedCard } from '@/lib/pilgrims/warehouse'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'
import { LinkCardButton } from './LinkCardButton'

// Gudang identitas jamaah (docs/arsitektur-jamaah.md §4.4, Fase 8) — semua peran staf (K4). Cari nama, atau NIK 16 digit (tepat, lewat indeks
// HMAC — NIK tak pernah tampil di daftar). Tampilan "Kartu tanpa identitas" = kartu bayi tanpa NIK untuk ditautkan petugas.
type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const VIEWS = { conflict: 'Ada konflik', unverified: 'Belum terverifikasi', unmatched: 'Kartu tanpa identitas' } as const
type View = keyof typeof VIEWS

export default async function IdentityWarehousePage({ params, searchParams }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  const actor = { userId: session.userId, role: session.role }
  const sp = await searchParams
  const list = parseListParams(sp)
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100)
  const view: View | undefined = typeof sp.status === 'string' && sp.status in VIEWS ? (sp.status as View) : undefined

  const base = `/${locale}/admin/identitas-jamaah`
  const limitParam = sp.limit === undefined ? undefined : list.limit
  const hrefFor = (over: Record<string, string | number | undefined>) => buildListHref(base, { q: q || undefined, status: view, limit: limitParam, ...over })
  const filters = (
    <FilterBar active={Boolean(q || view)} resetHref={buildListHref(base, { limit: limitParam })}>
      <SearchForm action={base} q={q} placeholder={view === 'unmatched' ? 'Cari nama…' : 'Cari nama atau NIK (16 digit)…'}
        preserve={{ status: view, limit: limitParam === undefined ? undefined : String(limitParam) }} clearHref={hrefFor({ q: undefined, page: 1 })} />
      <FilterSelect label="Tampilkan" allLabel="Semua identitas" value={view ?? ''} options={Object.entries(VIEWS).map(([value, label]) => ({ value, label }))}
        nav={{ base, param: 'status', query: { q: q || undefined, limit: limitParam === undefined ? undefined : String(limitParam) } }} />
    </FilterBar>
  )

  if (view === 'unmatched') {
    const r = await listUnmatchedCards(actor, { ...list, ...(q ? { q } : {}) })
    if (!r) redirect(`/${locale}/admin`)
    const columns: Column<UnmatchedCard>[] = [
      {
        key: 'card', header: 'Jamaah', mobile: 'title',
        cell: c => (
          <>
            <span className="text-[13px] font-semibold text-admin-ink">{c.fullName}</span>
            <div className="text-[12px] text-admin-muted">Lahir {c.birthDate ? formatCalendarDate(c.birthDate, DATE_LONG) : '-'} · Pemilik: {c.ownerName ?? c.ownerEmail}</div>
          </>
        ),
      },
      {
        key: 'suggest', header: 'Kemungkinan identitas',
        cell: c => c.suggestions.length === 0
          ? <span className="text-[12px] text-admin-muted">Belum ada yang mirip</span>
          : (
            <ul className="m-0 list-none space-y-1 p-0">
              {c.suggestions.map(s => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                  <a href={`${base}/${s.id}`} className="font-semibold text-admin-accent hover:text-admin-accent-strong">{s.fullName}</a>
                  <LinkCardButton cardId={c.id} identityId={s.id} label={`Tautkan ${c.fullName} ke ${s.fullName}`} />
                </li>
              ))}
            </ul>
          ),
      },
    ]
    return (
      <div className="space-y-5">
        <PageHeader title="Identitas Jamaah" description={`${r.meta.total} kartu tanpa identitas (bayi tanpa NIK)`} />
        {filters}
        <DataTable columns={columns} rows={r.items} getRowId={c => c.id} empty="Tidak ada kartu tanpa identitas."
          footer={r.meta.total > 0 ? <Pagination {...r.meta} hrefFor={page => hrefFor({ page })} /> : undefined} />
      </div>
    )
  }

  const r = await listIdentities(actor, { ...list, ...(q ? { q } : {}), filter: view ?? 'all' })
  const error = 'ok' in r ? r.error : null
  const rows = 'ok' in r ? [] : r.items
  const meta = 'ok' in r ? { page: 1, limit: list.limit, total: 0, totalPages: 1 } : r.meta
  const columns: Column<IdentityRow>[] = [
    {
      key: 'name', header: 'Identitas', mobile: 'title',
      cell: i => (
        <>
          <span className="text-[13px] font-semibold text-admin-ink">{i.fullName}</span>
          <div className="text-[12px] text-admin-muted">Lahir {i.birthDate ? formatCalendarDate(i.birthDate, DATE_LONG) : '-'} · {i.hasNik ? 'NIK' : `Paspor (${i.nationality})`}</div>
        </>
      ),
    },
    { key: 'cards', header: 'Kartu', cell: i => <span className="text-[12px]">{i.cards}</span> },
    { key: 'bookings', header: 'Booking', hideBelowLg: true, cell: i => <span className="text-[12px]">{i.bookings}</span> },
    {
      key: 'status', header: 'Status',
      cell: i => (
        <span className="flex flex-wrap gap-1">
          {i.conflicts > 0 && <Badge tone="danger">{i.conflicts} konflik</Badge>}
          <Badge tone={i.verified ? 'ok' : 'neutral'}>{i.verified ? 'Terverifikasi' : 'Belum terverifikasi'}</Badge>
        </span>
      ),
    },
    { key: 'actions', header: '', actions: true, cell: i => <RowActions><ActionLink kind="view" href={`${base}/${i.id}`} label={`Lihat identitas ${i.fullName}`} /></RowActions> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader title="Identitas Jamaah" description={`${meta.total} identitas${view ? ` — ${VIEWS[view].toLowerCase()}` : ''}`} />
      {filters}
      {error && <p role="alert" className="m-0 text-sm text-admin-danger">{error}</p>}
      <DataTable columns={columns} rows={rows} getRowId={i => i.id} empty="Tidak ada identitas yang cocok."
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => hrefFor({ page })} /> : undefined} />
    </div>
  )
}
