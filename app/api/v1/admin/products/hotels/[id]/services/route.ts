import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'
import { PriceInputError, setManualSell } from '@/lib/pricing/engine'
import { withSellPrice } from '@/lib/pricing/engine/read'

const createSchema = z.object({
  serviceName: z.string().min(1),
  serviceType: z.string().optional(),
  price:       z.coerce.number().positive(),
  description: z.string().optional(),
  isActive:    z.boolean().default(true),
})

type Ctx = { params: Promise<{ id: string }> }

// Menutup Gap #3 (docs/arsitektur-hotel.md §8): HotelService sudah ada di schema & tampil di
// halaman publik, tapi tidak pernah punya jalur admin untuk diisi — section publik selalu kosong.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id: hotelId } = await params
    const services = await withSellPrice('hotel_service', await prisma.hotelService.findMany({
      where: { hotelId },
      orderBy: { serviceName: 'asc' },
    }))
    return NextResponse.json(ok(services))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/services/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireManager()
    const { id: hotelId } = await params
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const service = await prisma.hotelService.create({ data: { ...parsed.data, hotelId } })
    // Harga awal → titik harga (harga manual, tercatat atas nama pembuat); selanjutnya diubah lewat PUT (juga lewat mesin harga).
    await setManualSell({ ownerType: 'hotel_service', ownerId: service.id, sellIdr: parsed.data.price, note: 'Harga awal saat layanan dibuat', byUserId: session.userId })
    return NextResponse.json(ok({ ...service, price: parsed.data.price }), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (e instanceof PriceInputError) return NextResponse.json(err(e.message), { status: 400 })
    console.error('[admin/products/hotels/[id]/services/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
