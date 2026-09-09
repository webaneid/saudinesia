import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const createSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd:   z.coerce.date(),
}).refine(d => d.periodEnd >= d.periodStart, {
  message: 'Tanggal akhir periode harus sama atau setelah tanggal mulai', path: ['periodEnd'],
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const periods = await prisma.hotelPricePeriod.findMany({
      where: { hotelId: id },
      include: { schedules: { include: { roomType: true } } },
      orderBy: { periodStart: 'asc' },
    })
    return NextResponse.json(ok(periods))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/periods/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { periodStart, periodEnd } = parsed.data

    // Validasi overlap periode untuk hotel yang sama — menutup Gap #7 lama (docs/arsitektur-hotel.md §8),
    // admin dikasih tahu eksplisit kalau bentrok, bukan diam-diam bikin 2 periode tumpang tindih.
    const overlap = await prisma.hotelPricePeriod.findFirst({
      where: { hotelId: id, isActive: true, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } },
    })
    if (overlap) {
      return NextResponse.json(err('Periode ini tumpang tindih dengan periode yang sudah ada untuk hotel ini'), { status: 409 })
    }

    const period = await prisma.hotelPricePeriod.create({
      data: { hotelId: id, periodStart, periodEnd },
      include: { schedules: { include: { roomType: true } } },
    })
    return NextResponse.json(ok(period), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/periods/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
