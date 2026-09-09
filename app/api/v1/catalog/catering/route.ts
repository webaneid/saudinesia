import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { detectSeason } from '@/lib/utils/season'
import { ok, err } from '@/lib/validators'

export async function GET() {
  try {
    const season   = await detectSeason(new Date())
    const options  = await prisma.cateringOption.findMany({ where: { isActive: true } })
    const priceKey = `pricePerPerson${season.charAt(0).toUpperCase() + season.slice(1)}` as
      'pricePerPersonRegular' | 'pricePerPersonRamadan' | 'pricePerPersonHajj'

    const data = options.map((o) => ({
      id: o.id, name: o.name, boardType: o.boardType, menuStyle: o.menuStyle,
      pricePerPersonPerDay: Number(o[priceKey]), season,
    }))
    return NextResponse.json(ok(data, { total: data.length, season }))
  } catch (error) {
    console.error('[catalog/catering]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
