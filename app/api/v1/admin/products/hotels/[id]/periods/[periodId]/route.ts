import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { periodUpdateSchema } from '@/lib/validators/hotelPeriod'
import { deletePeriod, updatePeriod } from '@/lib/hotels/periods'
import { periodFailure } from '@/lib/hotels/http'
import { withSellPrice } from '@/lib/pricing/engine/read'

// Satu periode: lihat / ubah tanggal & status / hapus-aman (docs/arsitektur-hotel.md §12.2). Periode harus milik hotel di URL.
type Ctx = { params: Promise<{ id: string; periodId: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id, periodId } = await params
    const period = await prisma.hotelPricePeriod.findFirst({ where: { id: periodId, hotelId: id }, include: { schedules: { include: { roomType: true } } } })
    if (!period) return NextResponse.json(err('Periode harga hotel tidak ditemukan'), { status: 404 })
    return NextResponse.json(ok({ ...period, schedules: await withSellPrice('hotel', period.schedules) }))
  } catch (e) {
    return periodFailure(e, 'admin/products/hotels/[id]/periods/[periodId]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id, periodId } = await params
    const parsed = periodUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    await updatePeriod(id, periodId, parsed.data)
    return NextResponse.json(ok(null))
  } catch (e) {
    return periodFailure(e, 'admin/products/hotels/[id]/periods/[periodId]/PUT')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id, periodId } = await params
    const r = await deletePeriod(id, periodId)
    return NextResponse.json(ok(r))
  } catch (e) {
    return periodFailure(e, 'admin/products/hotels/[id]/periods/[periodId]/DELETE')
  }
}
