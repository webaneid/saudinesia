import { getFeaturedCards } from '@/lib/media/urls'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { detectSeason } from '@/lib/utils/season'
import { cateringPricePerPersonPerDay } from '@/lib/pricing/computeCateringPrice'
import { ok, err } from '@/lib/validators'
import { cateringSeasonPrices } from '@/lib/pricing/engine/read'

export async function GET() {
  try {
    const season   = await detectSeason(new Date())
    const options  = await prisma.cateringOption.findMany({ where: { isActive: true } })

    const covers = await getFeaturedCards('catering', options.map(o => o.id))
    const prices = await cateringSeasonPrices(options.map(o => o.id))
    const data = options.map((o) => ({
      coverUrl: covers.get(o.id)?.src ?? null, coverAlt: covers.get(o.id)?.alt ?? null,
      id: o.id, name: o.name, boardType: o.boardType, menuStyle: o.menuStyle,
      pricePerPersonPerDay: cateringPricePerPersonPerDay(prices.get(o.id)!, season), season,
    }))
    return NextResponse.json(ok(data, { total: data.length, season }))
  } catch (error) {
    console.error('[catalog/catering]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
