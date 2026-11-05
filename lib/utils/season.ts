import { prisma } from '@/lib/db'

export type SeasonName = 'regular' | 'ramadan' | 'hajj'

/** `db` = klien transaksi bila dipanggil di dalam transaksi (SEC-212): jangan mengambil koneksi pool kedua. */
export async function detectSeason(date: Date, db: Pick<typeof prisma, 'season'> = prisma): Promise<SeasonName> {
  const season = await db.season.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
    select: { name: true },
  })
  return (season?.name as SeasonName) ?? 'regular'
}
