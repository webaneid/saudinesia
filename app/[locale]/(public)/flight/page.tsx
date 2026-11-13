import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Plane, PlaneLanding, SearchX } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { checkoutPath } from '@/lib/checkout/kinds'
import { formatRupiah } from '@/lib/utils'
import { withSellPrice } from '@/lib/pricing/engine/read'
import { flightAirlines } from '@/lib/catalog/flight'
import { CHECKOUT_MAX_PEOPLE } from '@/lib/validators/checkout'
import { buildListHref, paginate, parseListParams } from '@/lib/table/pagination'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { Pagination } from '@/components/shared/data-table/Pagination'
import { DATE_SHORT_MONTH, calendarDateOf, dbDateOf, formatCalendarDate, isCalendarDate, todayInApp, type CalendarDate } from '@/lib/time'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'
import { CatalogSection } from '@/components/shared/public/CatalogSection'
import { FlightSearch, type FlightSearchValue } from './FlightSearch'

// Katalog tiket pesawat (publik). Hero varian `search` (docs/arsitektur-frontend-publik.md §9 H2): kotak cari asal/tujuan/tanggal/pulang/jamaah → hasil
// jadwal yang periodenya memuat tanggal itu dan masih punya kursi, tombol Pesan membuka checkout yang SUDAH TERISI (lib/checkout/prefill.ts).
// Tanpa pencarian: tabel semua jadwal (kit tabel bersama, berpaginasi).

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Jumlah jadwal terdekat yang ditawarkan bila pencarian kosong (§9 R5). */
const NEAREST = 3
/** Batas jadwal yang dibaca per pencarian (master data kecil, tetap dibatasi — halaman publik tanpa login). */
const MAX_RESULTS = 200
/** Sisa kursi ditampilkan hanya bila tinggal sedikit (§9 R4). */
const FEW_SEATS = 10

function formatDate(d: Date | CalendarDate, locale: string) {
  return formatCalendarDate(d instanceof Date ? calendarDateOf(d) : d, DATE_SHORT_MONTH, locale)
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return catalogMetadata((await params).locale, 'flight')
}

type Row = { id: string; origin: string; destination: string; departureFrom: Date; departureTo: Date; price: number; airline: string | null }
type Sched = { id: string; departureFrom: Date; departureTo: Date; seatsLeft: number; price: number; route: { origin: string; destination: string } }

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '')
const seatsOf = (s: { totalSeats: number; pendingSeats: number; bookedSeats: number }) => Math.max(0, s.totalSeats - s.pendingSeats - s.bookedSeats)
const SCHEDULE_SELECT = {
  id: true, departureFrom: true, departureTo: true, totalSeats: true, pendingSeats: true, bookedSeats: true,
  route: { select: { origin: true, destination: true } },
} satisfies Prisma.FlightScheduleSelect

async function priced(where: Prisma.FlightScheduleWhereInput, take?: number): Promise<Sched[]> {
  const rows = await prisma.flightSchedule.findMany({ where, select: SCHEDULE_SELECT, orderBy: [{ departureFrom: 'asc' }, { id: 'asc' }], ...(take ? { take } : {}) })
  return (await withSellPrice('flight', rows)).map(r => ({ id: r.id, departureFrom: r.departureFrom, departureTo: r.departureTo, seatsLeft: seatsOf(r), price: r.price, route: r.route }))
}

export default async function FlightCatalogPage({ params, searchParams }: Props) {
  const { locale } = await params
  await requireCatalog('flight')
  const sp = await searchParams
  const today = todayInApp()
  const todayDb = dbDateOf(today)
  const base = `/${locale}/flight`

  const live: Prisma.FlightScheduleWhereInput = { isActive: true, route: { isActive: true }, departureTo: { gte: todayDb } }
  const [routes, content, t] = await Promise.all([
    prisma.flightRoute.findMany({ where: { isActive: true, schedules: { some: { isActive: true, departureTo: { gte: todayDb } } } }, select: { origin: true, destination: true }, orderBy: [{ origin: 'asc' }, { destination: 'asc' }] }),
    getPageContent(locale, 'flight'),
    getPageText(locale, 'flight'),
  ])

  // Parameter cari = DAFTAR PUTIH: kota hanya dari rute aktif, tanggal hanya YYYY-MM-DD ≥ hari ini, jamaah 1..maks. Nilai asing diabaikan (bukan 500).
  const from = routes.some(r => r.origin === one(sp.from)) ? one(sp.from) : ''
  const to = routes.some(r => r.destination === one(sp.to)) ? one(sp.to) : ''
  const date = isCalendarDate(one(sp.date)) && one(sp.date) >= today ? one(sp.date) as CalendarDate : ''
  const ret = date && isCalendarDate(one(sp.ret)) && one(sp.ret) >= date ? one(sp.ret) as CalendarDate : ''
  const paxRaw = Number(one(sp.pax))
  const pax = Number.isInteger(paxRaw) && paxRaw >= 1 && paxRaw <= CHECKOUT_MAX_PEOPLE ? paxRaw : 1
  const searching = Boolean(date)
  const initial: FlightSearchValue = { from, to, date, ret, pax }

  const search = (
    <FlightSearch locale={locale} routes={routes} initial={initial} today={today} maxPeople={CHECKOUT_MAX_PEOPLE}
      labels={{
        from: t('search.from'), to: t('search.to'), anyOrigin: t('search.anyOrigin'), anyDestination: t('search.anyDestination'), swap: t('search.swap'),
        date: t('search.date'), returnDate: t('search.returnDate'), returnOptional: t('search.returnOptional'), passengers: t('search.passengers'),
        submit: t('search.submit'), needDate: t('search.needDate'), datePast: t('search.datePast'), returnBefore: t('search.returnBefore'),
      }} />
  )

  const routeWhere: Prisma.FlightScheduleWhereInput = { ...live, route: { isActive: true, ...(from ? { origin: from } : {}), ...(to ? { destination: to } : {}) } }
  const totalLive = await prisma.flightSchedule.count({ where: live })
  const facts: HeroFact[] = totalLive > 0 ? [{ icon: Plane, label: t('facts.count', { count: totalLive }) }] : []

  let body: React.ReactNode
  if (searching) {
    const dateDb = dbDateOf(date as CalendarDate)
    const found = (await priced({ ...routeWhere, departureFrom: { lte: dateDb }, departureTo: { gte: dateDb } }, MAX_RESULTS))
      .filter(s => s.price > 0 && s.seatsLeft >= pax)
    // Tiket pulang (opsional): rute kebalikan yang periodenya memuat tanggal pulang, berharga, kursi cukup — termurah per rute.
    const returns = ret ? (await priced({ isActive: true, route: { isActive: true }, departureFrom: { lte: dbDateOf(ret) }, departureTo: { gte: dbDateOf(ret) } }, MAX_RESULTS))
      .filter(s => s.price > 0 && s.seatsLeft >= pax) : []
    const returnFor = (s: Sched) => returns.filter(r => r.route.origin === s.route.destination && r.route.destination === s.route.origin).sort((a, b) => a.price - b.price)[0] ?? null
    const nearest = found.length === 0
      ? (await priced(routeWhere, 50)).filter(s => s.price > 0 && s.seatsLeft >= pax).slice(0, NEAREST)
      : []
    const airlines = await flightAirlines([...found, ...returns, ...nearest].map(s => s.id))
    const searchHref = (d: CalendarDate) => `${base}?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), date: d, pax: String(pax) }).toString()}#catalog`

    body = (
      <CatalogSection
        title={t('results.title', { date: formatDate(date as CalendarDate, locale), count: pax })}
        description={from || to ? t('results.route', { from: from || t('search.anyOrigin'), to: to || t('search.anyDestination') }) : null}
        empty={{ icon: SearchX, text: t('results.empty', { date: formatDate(date as CalendarDate, locale) }) }}
        isEmpty={false}
      >
        {found.length === 0 ? (
          <div className="space-y-5 rounded-2xl border border-dashed p-8 text-center">
            <SearchX className="mx-auto h-10 w-10 text-muted-foreground opacity-40" aria-hidden />
            <p className="text-muted-foreground">{t('results.empty', { date: formatDate(date as CalendarDate, locale) })}</p>
            {nearest.length > 0 && (
              <div className="mx-auto max-w-xl space-y-2 text-left">
                <p className="text-sm font-semibold text-brand-dark">{t('results.nearest')}</p>
                <ul className="space-y-2">
                  {nearest.map(s => {
                    const start = calendarDateOf(s.departureFrom) < today ? today : calendarDateOf(s.departureFrom)
                    return (
                      <li key={s.id}>
                        <Link href={searchHref(start)} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm transition-colors hover:border-brand">
                          <span className="min-w-0">
                            <span className="block font-semibold text-brand-dark">{s.route.origin} → {s.route.destination}</span>
                            <span className="block text-muted-foreground">{t('results.period', { from: formatDate(s.departureFrom, locale), to: formatDate(s.departureTo, locale) })}</span>
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-brand">{formatRupiah(s.price)} <ArrowRight className="h-4 w-4" aria-hidden /></span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {found.map(s => {
              const back = returnFor(s)
              const airline = airlines.get(s.id)
              const total = (s.price + (back?.price ?? 0)) * pax
              const href = checkoutPath(locale, 'flight', s.id, { date, pax, ...(back ? { ret: back.id, retDate: ret } : {}) })
              return (
                <li key={s.id} className="grid gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-brand md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {airline && <span className="catalog-chip">{airline}</span>}
                      {s.seatsLeft <= FEW_SEATS && <span className="text-xs font-semibold text-destructive">{t('results.seatsLeft', { count: s.seatsLeft })}</span>}
                    </div>
                    <p className="flex items-center gap-2 text-lg font-semibold text-brand-dark">
                      <Plane className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {s.route.origin} → {s.route.destination}
                    </p>
                    <p className="text-sm text-muted-foreground">{t('results.departOn', { date: formatDate(date as CalendarDate, locale) })}</p>
                    {ret && (back ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <PlaneLanding className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                        {t('results.returnOn', { date: formatDate(ret, locale), route: `${back.route.origin} → ${back.route.destination}` })}{airlines.get(back.id) ? ` · ${airlines.get(back.id)}` : ''}
                      </p>
                    ) : <p className="text-sm text-muted-foreground">{t('results.noReturn', { date: formatDate(ret, locale) })}</p>)}
                  </div>
                  <div className="space-y-2 md:text-right">
                    <p className="text-xs text-muted-foreground">{t('results.perPerson', { price: formatRupiah(s.price + (back?.price ?? 0)) })}</p>
                    <p className="text-xl font-bold tabular-nums text-brand">{formatRupiah(total)}</p>
                    <p className="text-xs text-muted-foreground">{t('results.totalFor', { count: pax })}</p>
                    <Link href={href} className="btn-brand-solid w-full md:w-auto">{t('results.order')} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CatalogSection>
    )
  } else {
    const list = parseListParams(sp)
    const allWhere: Prisma.FlightScheduleWhereInput = { isActive: true, route: { isActive: true } }
    const { items, meta } = await paginate(
      list,
      () => prisma.flightSchedule.count({ where: allWhere }),
      range => prisma.flightSchedule.findMany({ where: allWhere, orderBy: [{ departureFrom: 'asc' }, { id: 'asc' }], include: { route: true }, ...range }),
    )
    const schedules = await withSellPrice('flight', items)
    const airlineByScheduleId = await flightAirlines(schedules.map(s => s.id))
    const rows: Row[] = schedules.map(s => ({
      id: s.id, origin: s.route.origin, destination: s.route.destination, departureFrom: s.departureFrom, departureTo: s.departureTo,
      price: Number(s.price), airline: airlineByScheduleId.get(s.id) ?? null,
    }))
    const limitParam = sp.limit === undefined ? undefined : String(list.limit)
    const columns: Column<Row>[] = [
      { key: 'route', header: t('table.route'), mobile: 'title', cell: r => <span className="text-sm font-semibold text-brand-dark">{r.origin} → {r.destination}</span> },
      { key: 'airline', header: t('table.airline'), cell: r => <span className="text-sm text-muted-foreground">{r.airline ?? '—'}</span> },
      { key: 'period', header: t('table.period'), cell: r => <span className="text-sm text-muted-foreground">{formatDate(r.departureFrom, locale)} – {formatDate(r.departureTo, locale)}</span> },
      // Belum berharga = tanda pisah, tak pernah "Rp 0" (§6.7 R3).
      { key: 'price', header: t('table.price'), align: 'right', cell: r => <span className="text-sm font-bold tabular-nums text-brand">{r.price > 0 ? formatRupiah(r.price) : '—'}</span> },
      // Checkout tiket (docs/arsitektur-booking-engine-v2.md §10.6) — hanya jadwal berharga yang periodenya belum lewat.
      {
        key: 'order', header: '', align: 'right', cell: r => r.price > 0 && calendarDateOf(r.departureTo) >= today
          ? <Link href={checkoutPath(locale, 'flight', r.id)} className="text-sm font-semibold text-brand hover:underline">{t('table.order')}</Link>
          : null,
      },
    ]
    body = (
      <CatalogSection title={t('list.title')} description={t('list.description')} empty={{ icon: Plane, text: t('list.empty') }} isEmpty={false}>
        <DataTable
          columns={columns} rows={rows} getRowId={r => r.id}
          empty={<span className="flex flex-col items-center gap-2"><Plane className="h-10 w-10 opacity-30" aria-hidden />{t('list.empty')}</span>}
          footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => buildListHref(base, { limit: limitParam, page })} /> : undefined}
        />
      </CatalogSection>
    )
  }

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} variant="search" search={routes.length > 0 ? search : undefined} />
      {body}
      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
