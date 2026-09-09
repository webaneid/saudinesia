import { prisma } from '@/lib/db'

export type SeasonName = 'regular' | 'ramadan' | 'hajj'

export async function detectSeason(date: Date): Promise<SeasonName> {
  const season = await prisma.season.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
    select: { name: true },
  })
  return (season?.name as SeasonName) ?? 'regular'
}
