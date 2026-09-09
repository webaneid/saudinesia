import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const updateSchema = z.object({
  periodStart: z.coerce.date().optional(),
  periodEnd:   z.coerce.date().optional(),
  isActive:    z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string; periodId: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { periodId } = await params
    const period = await prisma.hotelPricePeriod.findUnique({
      where: { id: periodId },
      include: { schedules: { include: { roomType: true } } },
    })
    if (!period) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok(period))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/periods/[periodId]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { periodId } = await params
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const period = await prisma.hotelPricePeriod.update({
      where: { id: periodId }, data: parsed.data, include: { schedules: { include: { roomType: true } } },
    })
    return NextResponse.json(ok(period))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/periods/[periodId]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { periodId } = await params

    // Periode yang salah satu tipe kamarnya masih punya booking — nonaktifkan (soft), bukan hapus
    // fisik. docs/arsitektur-hotel.md §11.3.
    const bookingCount = await prisma.bookingHotel.count({ where: { hotelRoomSchedule: { periodId } } })
    if (bookingCount > 0) {
      const period = await prisma.hotelPricePeriod.update({ where: { id: periodId }, data: { isActive: false } })
      return NextResponse.json(ok(period))
    }

    await prisma.hotelPricePeriod.delete({ where: { id: periodId } })
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/periods/[periodId]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
