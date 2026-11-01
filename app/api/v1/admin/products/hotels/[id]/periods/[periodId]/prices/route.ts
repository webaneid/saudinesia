import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { periodPricesSchema } from '@/lib/validators/hotelPeriod'
import { savePeriodPrices } from '@/lib/hotels/periods'
import { periodFailure } from '@/lib/hotels/http'
import { sellPrices, withSellPrice } from '@/lib/pricing/engine/read'

// Hotel punya persis 1 komponen HPP tetap "kamar" (docs/arsitektur-hotel.md §10.4) — pola sama Flight.
const COMPONENT_KAMAR = 'kamar'

type CostTier = { minDays: number; maxDays: number; cost: number }
type Ctx = { params: Promise<{ id: string; periodId: string }> }

// GET — vendor/currency (dari ProductCost tipe kamar PERTAMA di periode ini, karena semua tipe
// kamar dalam 1 periode selalu ditulis dengan vendor+currency yang sama lewat PUT di bawah) +
// harga per tipe kamar yang sudah ada. docs/arsitektur-hotel.md §11.3.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id, periodId } = await params

    const schedules = await prisma.hotelRoomSchedule.findMany({
      where: { periodId, isActive: true, period: { hotelId: id } },
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

    const prices = await sellPrices('hotel', scheduleIds)
    const rooms = schedules.map(s => {
      const cost = costByScheduleId.get(s.id)
      const tiers = (cost?.costTiers as unknown as CostTier[]) ?? []
      return {
        roomTypeId: s.roomTypeId, roomTypeName: s.roomType.name,
        scheduleId: s.id, cost: tiers[0]?.cost ?? null,
        totalQuota: s.totalQuota, price: prices.get(s.id) ?? 0,
      }
    })

    return NextResponse.json(ok({
      vendorId: first?.vendorId ?? null,
      currency: first?.currency ?? null,
      rooms,
    }))
  } catch (e) {
    return periodFailure(e, 'admin/products/hotels/[id]/periods/[periodId]/prices/GET')
  }
}

// PUT — simpan harga semua tipe kamar periode ini dalam satu transaksi (lib/hotels/periods.ts savePeriodPrices): vendor+currency SAMA untuk semua
// (docs/arsitektur-hotel.md §11.1 poin 1). Tipe kamar yang TIDAK dikirim dibiarkan; menghapusnya lewat DELETE …/rooms/[scheduleId] (§12.2).
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id, periodId } = await params
    const parsed = periodPricesSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const ids = await savePeriodPrices(id, periodId, parsed.data)
    const result = await withSellPrice('hotel', await prisma.hotelRoomSchedule.findMany({ where: { id: { in: ids } }, include: { roomType: true } }))
    return NextResponse.json(ok(result))
  } catch (e) {
    return periodFailure(e, 'admin/products/hotels/[id]/periods/[periodId]/prices/PUT')
  }
}
