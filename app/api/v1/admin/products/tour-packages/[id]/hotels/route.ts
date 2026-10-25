import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshTourPackagePriceCache } from '@/lib/pricing/refreshTourPackagePriceCache'
import { z } from 'zod'

const createSchema = z.object({
  hotelRoomScheduleId: z.string().min(1),
  nights:              z.coerce.number().int().min(1),
  numRooms:            z.coerce.number().int().min(1),
})

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: tourPackageId } = await params
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    // pricePerNight di-snapshot dari HotelRoomSchedule.price SERVER-SIDE saat dibuat — bukan
    // dari client. Setelah ini cuma referensi/default, admin bisa PUT untuk edit (§10.10).
    const schedule = await prisma.hotelRoomSchedule.findUniqueOrThrow({
      where: { id: parsed.data.hotelRoomScheduleId },
      select: { price: true },
    })

    const created = await prisma.tourPackageHotel.create({
      data: { tourPackageId, ...parsed.data, pricePerNight: schedule.price },
    })

    await refreshTourPackagePriceCache(tourPackageId)

    return NextResponse.json(ok(created), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/[id]/hotels/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
