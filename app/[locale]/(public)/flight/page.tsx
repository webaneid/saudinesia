import type { Metadata } from 'next'
import Link from 'next/link'
import { Plane } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { checkoutPath } from '@/lib/checkout/kinds'
import { formatRupiah } from '@/lib/utils'
import { escapeLike } from '@/lib/utils/search'
import { withSellPrice } from '@/lib/pricing/engine/read'
import { flightAirlines } from '@/lib/catalog/flight'
import { buildListHref, paginate, parseListParams } from '@/lib/table/pagination'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { FilterBar } from '@/components/shared/data-table/FilterBar'
import { Pagination } from '@/components/shared/data-table/Pagination'
import { SearchForm } from '@/components/shared/data-table/SearchForm'
import { DATE_SHORT_MONTH, calendarDateOf, formatCalendarDate, todayInApp } from '@/lib/time'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'
import { CatalogSection } from '@/components/shared/public/CatalogSection'

// Katalog tiket pesawat (publik) — pola katalog §6.7. Tabel + pencarian + paginasi memakai kit bersama (docs/arsitektur-tabel.md Fase 4): di HP tiap baris menjadi kartu.

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function formatDate(d: Date) {
  return formatCalendarDate(d, DATE_SHORT_MONTH)
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return catalogMetadata((await params).locale, 'flight')
}

type Row = { id: string; origin: string; destination: string; departureFrom: Date; departureTo: Date; price: number; airline: string | null }

export default async function FlightCatalogPage({ params, searchParams }: Props) {
  const { locale } = await params
  await requireCatalog('flight')
  const sp = await searchParams
  const list = parseListParams(sp)
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100)
  const like = { contains: escapeLike(q), mode: 'insensitive' as const }
  const where: Prisma.FlightScheduleWhereInput = {
    isActive: true,
    route: { isActive: true, ...(q ? { OR: [{ origin: like }, { destination: like }] } : {}) },
  }

  const allWhere: Prisma.FlightScheduleWhereInput = { isActive: true, route: { isActive: true } }
  const [{ items, meta }, totalAll, content, t] = await Promise.all([
    paginate(
      list,
      () => prisma.flightSchedule.count({ where }),
      range => prisma.flightSchedule.findMany({ where, orderBy: [{ departureFrom: 'asc' }, { id: 'asc' }], include: { route: true }, ...range }),
    ),
    q ? prisma.flightSchedule.count({ where: allWhere }) : null,
    getPageContent(locale, 'flight'),
    getPageText(locale, 'flight'),
  ])
  const total = totalAll ?? meta.total
  const schedules = await withSellPrice('flight', items)

  const airlineByScheduleId = await flightAirlines(schedules.map(s => s.id))
  const rows: Row[] = schedules.map(s => ({
    id: s.id, origin: s.route.origin, destination: s.route.destination, departureFrom: s.departureFrom, departureTo: s.departureTo,
    price: Number(s.price), airline: airlineByScheduleId.get(s.id) ?? null,
  }))

  const base = `/${locale}/flight`
  const today = todayInApp()
  const limitParam = sp.limit === undefined ? undefined : String(list.limit)
  const columns: Column<Row>[] = [
    { key: 'route', header: t('table.route'), mobile: 'title', cell: r => <span className="text-sm font-semibold text-brand-dark">{r.origin} → {r.destination}</span> },
    { key: 'airline', header: t('table.airline'), cell: r => <span className="text-sm text-muted-foreground">{r.airline ?? '—'}</span> },
    { key: 'period', header: t('table.period'), cell: r => <span className="text-sm text-muted-foreground">{formatDate(r.departureFrom)} – {formatDate(r.departureTo)}</span> },
    // Belum berharga = tanda pisah, tak pernah "Rp 0" (§6.7 R3).
    { key: 'price', header: t('table.price'), align: 'right', cell: r => <span className="text-sm font-bold tabular-nums text-brand">{r.price > 0 ? formatRupiah(r.price) : '—'}</span> },
    // Checkout tiket (docs/arsitektur-booking-engine-v2.md §10.6) — hanya jadwal berharga yang periodenya belum lewat.
    {
      key: 'order', header: '', align: 'right', cell: r => r.price > 0 && calendarDateOf(r.departureTo) >= today
        ? <Link href={checkoutPath(locale, 'flight', r.id)} className="text-sm font-semibold text-brand hover:underline">{t('table.order')}</Link>
        : null,
    },
  ]
  const facts: HeroFact[] = total > 0 ? [{ icon: Plane, label: t('facts.count', { count: total }) }] : []

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} />

      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: Plane, text: t('list.empty') }}
        isEmpty={false}
        toolbar={
          <FilterBar active={Boolean(q)} resetHref={buildListHref(base, { limit: limitParam })}>
            <SearchForm action={base} q={q} placeholder={t('list.search')} preserve={{ limit: limitParam }} clearHref={buildListHref(base, { limit: limitParam })} />
          </FilterBar>
        }
      >
        <DataTable
          columns={columns} rows={rows} getRowId={r => r.id}
          empty={q ? t('list.emptyFiltered') : (
            <span className="flex flex-col items-center gap-2"><Plane className="h-10 w-10 opacity-30" aria-hidden />{t('list.empty')}</span>
          )}
          footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => buildListHref(base, { q: q || undefined, limit: limitParam, page })} /> : undefined}
        />
      </CatalogSection>

      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
