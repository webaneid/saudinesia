import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { z } from 'zod'
import { sellPrice, withSellPrice } from '@/lib/pricing/engine/read'

// price TIDAK ada di sini secara sengaja — satu-satunya jalur penulisan adalah
// repriceOwner('flight', id) (lib/pricing/engine), lihat docs/arsitektur-tiket-pesawat.md §9 poin 7.
const updateSchema = z.object({
  routeId:       z.string().min(1).optional(),
  departureFrom: z.coerce.date().optional(),
  departureTo:   z.coerce.date().optional(),
  totalSeats:    z.coerce.number().int().min(0).optional(),
  isActive:      z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const schedule = await prisma.flightSchedule.findUnique({ where: { id }, include: { route: true } })
    if (!schedule) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok({ ...schedule, price: await sellPrice('flight', id) }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/schedules/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const schedule = await prisma.flightSchedule.update({ where: { id }, data: parsed.data, include: { route: true } })
    return NextResponse.json(ok({ ...schedule, price: await sellPrice('flight', id) }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Jadwal penerbangan tidak ditemukan'), { status: 404 })
    console.error('[admin/products/flight/schedules/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params

    // Jadwal yang masih punya booking (walau belum ada pemanggil di fase ini, siap-siap kalau
    // ada) — nonaktifkan (soft), bukan hapus fisik. docs/arsitektur-tiket-pesawat.md §9 poin 8.
    const bookingCount = await prisma.bookingFlight.count({ where: { flightScheduleId: id } })
    if (bookingCount > 0) {
      const schedule = await prisma.flightSchedule.update({ where: { id }, data: { isActive: false } })
      return NextResponse.json(ok(schedule))
    }

    await prisma.flightSchedule.delete({ where: { id } })
    await prisma.pricePoint.deleteMany({ where: { ownerType: 'flight', ownerId: id } }) // titik harga ikut (tanpa FK)
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Jadwal penerbangan tidak ditemukan'), { status: 404 })
    console.error('[admin/products/flight/schedules/[id]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
