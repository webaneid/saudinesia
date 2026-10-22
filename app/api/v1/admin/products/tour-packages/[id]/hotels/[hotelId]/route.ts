import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { refreshTourPackagePriceCache } from '@/lib/pricing/refreshTourPackagePriceCache'
import { z } from 'zod'

const updateSchema = z.object({
  nights:        z.coerce.number().int().min(1).optional(),
  numRooms:      z.coerce.number().int().min(1).optional(),
  pricePerNight: z.coerce.number().positive().optional(),
})

type Ctx = { params: Promise<{ id: string; hotelId: string }> }

// Admin bisa edit nights/numRooms/pricePerNight kapan saja — pricePerNight cuma referensi/default
// dari HotelRoomSchedule saat pertama ditambahkan, bukan angka terkunci (§10.10).
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: tourPackageId, hotelId } = await params
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    await prisma.tourPackageHotel.update({ where: { id: hotelId }, data: parsed.data })
    await refreshTourPackagePriceCache(tourPackageId)

    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Hotel paket tidak ditemukan'), { status: 404 })
    console.error('[admin/products/tour-packages/[id]/hotels/[hotelId]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: tourPackageId, hotelId } = await params

    await prisma.tourPackageHotel.delete({ where: { id: hotelId } })
    await refreshTourPackagePriceCache(tourPackageId)

    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Hotel paket tidak ditemukan'), { status: 404 })
    console.error('[admin/products/tour-packages/[id]/hotels/[hotelId]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
