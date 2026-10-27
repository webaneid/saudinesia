import { prisma } from '@/lib/db'
import { detectSeason, type SeasonName } from '@/lib/utils/season'
import { ItemNotBookableError } from '@/lib/booking/errors'

// Harga katering — dihitung SERVER-SIDE dari CateringOption (harga per orang per hari, 3 musim). Sebelumnya route booking memakai `totalPrice`
// kiriman klien apa adanya (siapa pun yang login bisa memesan seharga Rp 1) dan harga di database tidak pernah dibaca
// (docs/arsitektur-harga-terpadu.md §1.2-6). Fase 1 memindahkan sumber harga ini ke PricePoint; titik pemanggilnya tetap satu fungsi ini.

type SeasonPrices = { pricePerPersonRegular: unknown; pricePerPersonRamadan: unknown; pricePerPersonHajj: unknown }

const SEASON_KEY: Record<SeasonName, keyof SeasonPrices> = {
  regular: 'pricePerPersonRegular',
  ramadan: 'pricePerPersonRamadan',
  hajj: 'pricePerPersonHajj',
}

/** Harga per orang per hari untuk satu musim — SATU tempat memilih kolom musim (katalog publik dan booking memakainya). */
export function cateringPricePerPersonPerDay(option: SeasonPrices, season: SeasonName): number {
  return Number(option[SEASON_KEY[season]])
}

export type CateringBookingPrice = { season: SeasonName; pricePerPersonPerDay: number; totalPrice: number }

/**
 * Total katering untuk satu item booking: harga musim pada TANGGAL MULAI × hari × orang. Opsi tidak ada/nonaktif atau harga musim itu ≤ 0 →
 * ItemNotBookableError (422), pola sama Haji (SEC-66) — katering yang belum berharga tidak boleh terjual gratis.
 */
export async function computeCateringBookingPrice(input: { cateringOptionId: string; startDate: Date; numDays: number; numPeople: number }): Promise<CateringBookingPrice> {
  const option = await prisma.cateringOption.findUnique({ where: { id: input.cateringOptionId } })
  if (!option || !option.isActive) throw new ItemNotBookableError('Paket katering tidak tersedia.')
  const season = await detectSeason(input.startDate)
  const pricePerPersonPerDay = cateringPricePerPersonPerDay(option, season)
  if (!Number.isFinite(pricePerPersonPerDay) || pricePerPersonPerDay <= 0) {
    throw new ItemNotBookableError('Paket katering ini belum berharga untuk periode tersebut — hubungi admin.')
  }
  const totalPrice = Math.round(pricePerPersonPerDay * input.numDays * input.numPeople * 100) / 100
  return { season, pricePerPersonPerDay, totalPrice }
}
