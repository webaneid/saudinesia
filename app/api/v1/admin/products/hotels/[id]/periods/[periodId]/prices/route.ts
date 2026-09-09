import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { refreshHotelRoomScheduleCache } from '@/lib/pricing/refreshHotelRoomScheduleCache'
import { z } from 'zod'

// Hotel punya persis 1 komponen HPP tetap "kamar" (docs/arsitektur-hotel.md §10.4) — pola sama Flight.
const COMPONENT_KAMAR = 'kamar'
const FLAT_TIER = { minDays: 0, maxDays: 9999 }

type CostTier = { minDays: number; maxDays: number; cost: number }
type Ctx = { params: Promise<{ periodId: string }> }

const putSchema = z.object({
  vendorId: z.string().min(1),
  currency: z.string().min(1),
  rooms: z.array(z.object({
    roomTypeId: z.string().min(1),
    cost:       z.coerce.number().positive(),
    totalQuota: z.coerce.number().int().min(0).default(0),
  })).min(1, 'Isi harga minimal 1 tipe kamar'),
})

// GET — vendor/currency (dari ProductCost tipe kamar PERTAMA di periode ini, karena semua tipe
// kamar dalam 1 periode selalu ditulis dengan vendor+currency yang sama lewat PUT di bawah) +
// harga per tipe kamar yang sudah ada. docs/arsitektur-hotel.md §11.3.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { periodId } = await params

    const schedules = await prisma.hotelRoomSchedule.findMany({
      where: { periodId, isActive: true },
      include: { roomType: true },
    })
    const scheduleIds = schedules.map(s => s.id)
    const costs = scheduleIds.length > 0
      ? await prisma.productCost.findMany({
          where: { productType: 'hotel', productId: { in: scheduleIds }, costComponent: COMPONENT_KAMAR, isActive: true },
        })
      : []
    const costByScheduleId = new Map(costs.map(c => [c.productId, c]))
    const first = costs[0]

    const rooms = schedules.map(s => {
      const cost = costByScheduleId.get(s.id)
      const tiers = (cost?.costTiers as unknown as CostTier[]) ?? []
      return {
        roomTypeId: s.roomTypeId, roomTypeName: s.roomType.name,
        scheduleId: s.id, cost: tiers[0]?.cost ?? null,
        totalQuota: s.totalQuota, price: Number(s.price),
      }
    })

    return NextResponse.json(ok({
      vendorId: first?.vendorId ?? null,
      currency: first?.currency ?? null,
      rooms,
    }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/periods/[periodId]/prices/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// PUT — bulk upsert: vendor+currency SAMA untuk semua tipe kamar yang dikirim (docs/arsitektur-hotel.md
// §11.1 poin 1). Tipe kamar yang TIDAK dikirim di `rooms` — baris lamanya (kalau ada) dibiarkan,
// tidak otomatis dihapus/nonaktif (safer default, admin hapus manual kalau memang dimaksudkan).
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { periodId } = await params
    const parsed = putSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { vendorId, currency, rooms } = parsed.data

    const period = await prisma.hotelPricePeriod.findUnique({ where: { id: periodId } })
    if (!period) return NextResponse.json(err('Periode tidak ditemukan'), { status: 404 })

    const updatedScheduleIds: string[] = []

    for (const room of rooms) {
      const schedule = await prisma.hotelRoomSchedule.upsert({
        where: { periodId_roomTypeId: { periodId, roomTypeId: room.roomTypeId } },
        create: { periodId, roomTypeId: room.roomTypeId, totalQuota: room.totalQuota, price: 0 },
        update: { totalQuota: room.totalQuota },
      })

      const costTiers: CostTier[] = [{ ...FLAT_TIER, cost: room.cost }]
      const existingCost = await prisma.productCost.findFirst({
        where: { productType: 'hotel', productId: schedule.id, costComponent: COMPONENT_KAMAR },
      })
      if (existingCost) {
        await prisma.productCost.update({
          where: { id: existingCost.id }, data: { vendorId, currency, costTiers, isActive: true },
        })
      } else {
        await prisma.productCost.create({
          data: { productType: 'hotel', productId: schedule.id, costComponent: COMPONENT_KAMAR, vendorId, currency, costTiers },
        })
      }

      await prisma.preferredVendor.upsert({
        where: { productType_productId_costComponent: { productType: 'hotel', productId: schedule.id, costComponent: COMPONENT_KAMAR } },
        create: { productType: 'hotel', productId: schedule.id, costComponent: COMPONENT_KAMAR, vendorId },
        update: { vendorId },
      })

      updatedScheduleIds.push(schedule.id)
    }

    for (const scheduleId of updatedScheduleIds) {
      await refreshHotelRoomScheduleCache(scheduleId)
    }

    const result = await prisma.hotelRoomSchedule.findMany({
      where: { id: { in: updatedScheduleIds } },
      include: { roomType: true },
    })
    return NextResponse.json(ok(result))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/hotels/[id]/periods/[periodId]/prices/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
