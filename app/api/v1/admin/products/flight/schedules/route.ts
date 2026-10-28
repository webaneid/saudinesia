import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { getFlightAirlineNames } from '@/lib/pricing/flightAirlines'
import { z } from 'zod'
import { sellPrice, withSellPrice } from '@/lib/pricing/engine/read'

// price TIDAK ada di sini secara sengaja (docs/arsitektur-tiket-pesawat.md §9 poin 7, sama pelajaran
// docs/arsitektur-harga.md §17) — jadwal baru dibuat dengan price:0, terisi otomatis setelah
// admin mengisi komponen HPP lewat endpoint .../[id]/cost.
const createSchema = z.object({
  routeId:       z.string().min(1),
  departureFrom: z.coerce.date(),
  departureTo:   z.coerce.date(),
  totalSeats:    z.coerce.number().int().min(0).default(0),
  isActive:      z.boolean().default(true),
}).refine(d => d.departureTo >= d.departureFrom, {
  message: 'Tanggal akhir periode harus sama atau setelah tanggal mulai', path: ['departureTo'],
})

export async function GET(req: Request) {
  try {
    await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const like = { contains: escapeLike(cq.q), mode: 'insensitive' as const }
    const where = { ...activeFilter(cq.status), ...(cq.q ? { route: { OR: [{ origin: like }, { destination: like }] } } : {}) }
    const { items: found, meta } = await paginateCatalog(cq.list, () => prisma.flightSchedule.count({ where }), range => prisma.flightSchedule.findMany({
      where,
      include: { route: true },
      orderBy: [{ departureFrom: 'asc' }, { id: 'asc' }],
      ...range,
    }))
    const schedules = await withSellPrice('flight', found)
    const airlineByScheduleId = await getFlightAirlineNames(schedules.map(s => s.id))
    return NextResponse.json(ok(
      schedules.map(s => ({ ...s, airlineName: airlineByScheduleId.get(s.id) ?? null })), meta
    ))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/schedules/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const { routeId, departureFrom, departureTo, totalSeats, isActive } = parsed.data
    const schedule = await prisma.flightSchedule.create({
      data: { routeId, departureFrom, departureTo, totalSeats, isActive },
      include: { route: true },
    })
    return NextResponse.json(ok(schedule), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/schedules/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
