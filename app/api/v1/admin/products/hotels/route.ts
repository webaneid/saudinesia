import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'

const createSchema = z.object({
  name:             z.string().min(1),
  city:             z.enum(['makkah', 'madinah']),
  stars:            z.coerce.number().int().min(1).max(5).optional(),
  distanceToHaramM: z.coerce.number().int().min(0).optional(),
  description:      richTextField().nullish(), // teks kaya, docs/arsitektur-editor-teks.md
  facilities:       z.array(z.string()).default([]),
})

export async function GET() {
  try {
    await requireManager()
    const hotels = await prisma.hotel.findMany({
      include: { _count: { select: { pricePeriods: true } } },
      orderBy: { city: 'asc' },
    })
    return NextResponse.json(ok(hotels))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const hotel = await prisma.hotel.create({
      data: { ...parsed.data, description: emptyToNull(parsed.data.description) },
    })
    return NextResponse.json(ok(hotel), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
