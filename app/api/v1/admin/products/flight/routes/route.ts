import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const createSchema = z.object({
  origin:      z.string().min(1),
  destination: z.string().min(1),
  isActive:    z.boolean().default(true),
})

export async function GET() {
  try {
    await requireManager()
    const routes = await prisma.flightRoute.findMany({
      orderBy: [{ origin: 'asc' }, { destination: 'asc' }],
    })
    return NextResponse.json(ok(routes))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/routes/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const route = await prisma.flightRoute.create({ data: parsed.data })
    return NextResponse.json(ok(route), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/routes/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
