import { prisma } from '@/lib/db'
import { detectSeason, type SeasonName } from '@/lib/utils/season'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { cateringSeasonPrices, type CateringSeasonPrices } from './engine/read'
import { readPoint, type TakenPoint } from './engine/snapshot'
import type { Prisma } from '@prisma/client'

// Harga katering — dihitung SERVER-SIDE dari CateringOption (harga per orang per hari, 3 musim). Sebelumnya route booking memakai `totalPrice`
// kiriman klien apa adanya (siapa pun yang login bisa memesan seharga Rp 1) dan harga di database tidak pernah dibaca
// (docs/arsitektur-harga-terpadu.md §1.2-6). Sejak Fase 3 sumbernya titik harga `catering` (tiga musim, diisi admin di PriceCard); titik pemanggilnya tetap satu fungsi ini.

/** Harga per orang per hari untuk satu musim dari harga tiga-musim titik harga (`cateringSeasonPrices`) — SATU tempat memilih musim (katalog publik dan booking). */
export function cateringPricePerPersonPerDay(prices: CateringSeasonPrices, season: SeasonName): number {
  return prices[season]
}

export type CateringBookingPrice = { season: SeasonName; pricePerPersonPerDay: number; totalPrice: number; point: TakenPoint }

/**
 * Total katering untuk satu item booking: harga musim pada TANGGAL MULAI × hari × orang. Opsi tidak ada/nonaktif atau harga musim itu ≤ 0 →
 * ItemNotBookableError (422), pola sama Haji (SEC-66) — katering yang belum berharga tidak boleh terjual gratis.
 * `db` = klien transaksi: titik harga yang dikembalikan (`point`) adalah bacaan yang SAMA yang dibekukan ke snapshot.
 */
export async function computeCateringBookingPrice(
  input: { cateringOptionId: string; startDate: Date; numDays: number; numPeople: number },
  db: Pick<Prisma.TransactionClient, 'cateringOption' | 'pricePoint' | 'priceSnapshot'> = prisma,
): Promise<CateringBookingPrice> {
  const option = await db.cateringOption.findUnique({ where: { id: input.cateringOptionId }, select: { isActive: true } })
  if (!option || !option.isActive) throw new ItemNotBookableError('Paket katering tidak tersedia.')
  const season = await detectSeason(input.startDate)
  const point = await readPoint(db, 'catering', input.cateringOptionId, `season:${season}`)
  const pricePerPersonPerDay = point?.sellIdr ?? 0
  if (!point || !Number.isFinite(pricePerPersonPerDay) || pricePerPersonPerDay <= 0) {
    throw new ItemNotBookableError('Paket katering ini belum berharga untuk periode tersebut — hubungi admin.')
  }
  const totalPrice = Math.round(pricePerPersonPerDay * input.numDays * input.numPeople * 100) / 100
  return { season, pricePerPersonPerDay, totalPrice, point }
}
