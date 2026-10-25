import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

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
    const services = await prisma.hotelService.findMany({
      where: { hotelId },
      orderBy: { serviceName: 'asc' },
    })
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
    await requireManager()
    const { id: hotelId } = await params
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const service = await prisma.hotelService.create({ data: { ...parsed.data, hotelId } })
    return NextResponse.json(ok(service), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/services/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
