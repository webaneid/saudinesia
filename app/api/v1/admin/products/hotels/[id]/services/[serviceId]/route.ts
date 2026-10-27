import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { z } from 'zod'
import { PriceInputError, setManualSell } from '@/lib/pricing/engine'
import { sellPrice } from '@/lib/pricing/engine/read'

const updateSchema = z.object({
  serviceName: z.string().min(1).optional(),
  serviceType: z.string().nullable().optional(),
  price:       z.coerce.number().positive().optional(),
  description: z.string().nullable().optional(),
  isActive:    z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string; serviceId: string }> }

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireManager()
    const { serviceId } = await params
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    // Harga lewat mesin harga (audit + penulisan ganda ke kolom lama), bidang lain langsung.
    const { price, ...rest } = parsed.data
    const service = Object.keys(rest).length > 0
      ? await prisma.hotelService.update({ where: { id: serviceId }, data: rest })
      : await prisma.hotelService.findUniqueOrThrow({ where: { id: serviceId } })
    if (price !== undefined) await setManualSell({ ownerType: 'hotel_service', ownerId: serviceId, sellIdr: price, byUserId: session.userId })
    return NextResponse.json(ok({ ...service, price: await sellPrice('hotel_service', serviceId) }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Layanan hotel tidak ditemukan'), { status: 404 })
    if (e instanceof PriceInputError) return NextResponse.json(err(e.message), { status: 400 })
    console.error('[admin/products/hotels/[id]/services/[serviceId]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Tidak dihapus permanen kalau sudah pernah dipakai booking — nonaktifkan via isActive
// (pola sama modul lain). Cek dulu ada booking_services yang mereferensikan sebelum hard-delete.
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { serviceId } = await params
    const usageCount = await prisma.bookingService.count({ where: { hotelServiceId: serviceId } })
    if (usageCount > 0) {
      await prisma.hotelService.update({ where: { id: serviceId }, data: { isActive: false } })
      return NextResponse.json(ok(null, { softDeleted: true }))
    }
    await prisma.$transaction([prisma.pricePoint.deleteMany({ where: { ownerType: 'hotel_service', ownerId: serviceId } }), prisma.hotelService.delete({ where: { id: serviceId } })])
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Layanan hotel tidak ditemukan'), { status: 404 })
    console.error('[admin/products/hotels/[id]/services/[serviceId]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
