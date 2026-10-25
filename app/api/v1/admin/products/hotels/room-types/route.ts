import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const createSchema = z.object({
  name:            z.string().min(1),
  defaultCapacity: z.coerce.number().int().min(1),
})

export async function GET() {
  try {
    await requireManager()
    const roomTypes = await prisma.roomType.findMany({ where: { isActive: true }, orderBy: { defaultCapacity: 'asc' } })
    return NextResponse.json(ok(roomTypes))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/room-types/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const roomType = await prisma.roomType.create({ data: parsed.data })
    return NextResponse.json(ok(roomType), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/room-types/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
