import { Plane } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { formatRupiah } from '@/lib/utils'
import { escapeLike } from '@/lib/utils/search'
import { withSellPrice } from '@/lib/pricing/engine/read'
import { buildListHref, paginate, parseListParams } from '@/lib/table/pagination'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { FilterBar } from '@/components/shared/data-table/FilterBar'
import { Pagination } from '@/components/shared/data-table/Pagination'
import { SearchForm } from '@/components/shared/data-table/SearchForm'
import { DATE_SHORT_MONTH, formatCalendarDate } from '@/lib/time'

// Katalog tiket pesawat (publik). Tabel + pencarian + paginasi memakai kit bersama (docs/arsitektur-tabel.md Fase 4): di HP tiap baris menjadi kartu.

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function formatDate(d: Date) {
  return formatCalendarDate(d, DATE_SHORT_MONTH)
}

type Row = { id: string; origin: string; destination: string; departureFrom: Date; departureTo: Date; price: number; airline: string | null }

export default async function FlightCatalogPage({ params, searchParams }: Props) {
  const { locale } = await params
  const sp = await searchParams
  const list = parseListParams(sp)
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 100)
  const like = { contains: escapeLike(q), mode: 'insensitive' as const }
  const where: Prisma.FlightScheduleWhereInput = {
    isActive: true,
    route: { isActive: true, ...(q ? { OR: [{ origin: like }, { destination: like }] } : {}) },
  }

  const { items, meta } = await paginate(
    list,
    () => prisma.flightSchedule.count({ where }),
    range => prisma.flightSchedule.findMany({ where, orderBy: [{ departureFrom: 'asc' }, { id: 'asc' }], include: { route: true }, ...range }),
  )
  const schedules = await withSellPrice('flight', items)

  // Satu query batch untuk maskapai halaman ini (Vendor lewat ProductCost) — bukan N+1 per jadwal.
  const costs = await prisma.productCost.findMany({
    where: { productType: 'flight', productId: { in: schedules.map(s => s.id) }, costComponent: 'tiket', isActive: true },
    include: { vendor: true },
  })
  const airlineByScheduleId = new Map(costs.map(c => [c.productId, c.vendor.name]))
  const rows: Row[] = schedules.map(s => ({
    id: s.id, origin: s.route.origin, destination: s.route.destination, departureFrom: s.departureFrom, departureTo: s.departureTo,
    price: Number(s.price), airline: airlineByScheduleId.get(s.id) ?? null,
  }))

  const base = `/${locale}/flight`
  const limitParam = sp.limit === undefined ? undefined : String(list.limit)
  const columns: Column<Row>[] = [
    { key: 'route', header: 'Rute', mobile: 'title', cell: r => <span className="text-[14px] font-semibold">{r.origin} → {r.destination}</span> },
    { key: 'airline', header: 'Maskapai', cell: r => <span className="text-[13px] text-admin-muted">{r.airline ?? '—'}</span> },
    { key: 'period', header: 'Periode Keberangkatan', cell: r => <span className="text-[13px] text-admin-muted">{formatDate(r.departureFrom)} – {formatDate(r.departureTo)}</span> },
    { key: 'price', header: 'Harga', align: 'right', cell: r => <span className="text-[14px] font-bold tabular-nums text-admin-accent">{formatRupiah(r.price)}</span> },
  ]

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Plane className="h-8 w-8 text-admin-accent" />
          Tiket Pesawat
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Jadwal penerbangan untuk keberangkatan umroh &amp; haji — harga per orang, berlaku untuk periode
          keberangkatan yang tertera.
        </p>
      </div>

      <div className="space-y-4">
        <FilterBar active={Boolean(q)} resetHref={buildListHref(base, { limit: limitParam })}>
          <SearchForm action={base} q={q} placeholder="Cari kota asal / tujuan…" preserve={{ limit: limitParam }} clearHref={buildListHref(base, { limit: limitParam })} />
        </FilterBar>
        <DataTable
          columns={columns} rows={rows} getRowId={r => r.id}
          empty={q ? 'Tidak ada jadwal yang cocok dengan pencarian.' : (
            <span className="flex flex-col items-center gap-2"><Plane className="h-10 w-10 opacity-30" />Jadwal penerbangan akan segera tersedia.</span>
          )}
          footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => buildListHref(base, { q: q || undefined, limit: limitParam, page })} /> : undefined}
        />
      </div>
    </div>
  )
}
