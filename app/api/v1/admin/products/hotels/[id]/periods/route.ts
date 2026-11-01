import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { periodCreateSchema } from '@/lib/validators/hotelPeriod'
import { createPeriod } from '@/lib/hotels/periods'
import { periodFailure } from '@/lib/hotels/http'
import { sellPrices } from '@/lib/pricing/engine/read'

// Periode harga hotel (docs/arsitektur-hotel.md §11–§12). Penulis: lib/hotels/periods.ts.
type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const periods = await prisma.hotelPricePeriod.findMany({
      where: { hotelId: id },
      include: { schedules: { include: { roomType: true }, orderBy: [{ roomType: { defaultCapacity: 'asc' } }, { id: 'asc' }] } },
      orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
    })
    const prices = await sellPrices('hotel', periods.flatMap(p => p.schedules.map(s => s.id)))
    return NextResponse.json(ok(periods.map(p => ({ ...p, schedules: p.schedules.map(s => ({ ...s, price: prices.get(s.id) ?? 0 })) }))))
  } catch (e) {
    return periodFailure(e, 'admin/products/hotels/[id]/periods/GET')
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = periodCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    return NextResponse.json(ok(await createPeriod(id, parsed.data)), { status: 201 })
  } catch (e) {
    return periodFailure(e, 'admin/products/hotels/[id]/periods/POST')
  }
}
