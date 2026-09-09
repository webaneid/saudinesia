import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshTourPackagePriceCache } from '@/lib/pricing/refreshTourPackagePriceCache'
import { z } from 'zod'

// Opsi hotel untuk mode user_choice (docs/arsitektur-ziarah.md §12.3) — daftar tipe kamar yang
// DITAWARKAN ke pilgrim, bukan dikunci. Harga live dari HotelRoomSchedule.price, tidak pernah
// masuk ke harga jual paket dasar — tidak perlu refresh cache saat tambah/hapus baris di sini
// (beda dari TourPackageHotel yang mode included).
const createSchema = z.object({
  hotelRoomScheduleId: z.string().min(1),
  nights:              z.coerce.number().int().min(1),
})
const removeSchema = z.object({
  hotelRoomScheduleId: z.string().min(1),
})

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: tourPackageId } = await params
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const existing = await prisma.tourPackageHotelOption.findUnique({
      where: { tourPackageId_hotelRoomScheduleId: { tourPackageId, hotelRoomScheduleId: parsed.data.hotelRoomScheduleId } },
    })
    if (existing) return NextResponse.json(err('Opsi hotel ini sudah ada'), { status: 409 })

    const created = await prisma.tourPackageHotelOption.create({
      data: { tourPackageId, ...parsed.data },
    })

    return NextResponse.json(ok(created), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/[id]/hotel-options/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: tourPackageId } = await params
    const parsed = removeSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    await prisma.tourPackageHotelOption.delete({
      where: { tourPackageId_hotelRoomScheduleId: { tourPackageId, hotelRoomScheduleId: parsed.data.hotelRoomScheduleId } },
    })

    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/[id]/hotel-options/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
