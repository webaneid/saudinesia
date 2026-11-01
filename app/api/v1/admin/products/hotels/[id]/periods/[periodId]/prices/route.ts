import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok } from '@/lib/validators'
import { periodFailure } from '@/lib/hotels/http'
import { sellPrices } from '@/lib/pricing/engine/read'

// Hotel punya persis 1 komponen HPP tetap "kamar" (docs/arsitektur-hotel.md §10.4) — pola sama Flight.
const COMPONENT_KAMAR = 'kamar'

type CostTier = { minDays: number; maxDays: number; cost: number }
type Ctx = { params: Promise<{ id: string; periodId: string }> }

// GET — vendor/currency (dari ProductCost tipe kamar PERTAMA di periode ini, karena semua tipe
// kamar dalam 1 periode selalu ditulis dengan vendor+currency yang sama) +
// harga per tipe kamar yang sudah ada, untuk mengisi formulir periode (Edit/Duplikat). Menyimpan lewat PUT …/periods/[periodId] (tanggal + isi satu transaksi).
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
