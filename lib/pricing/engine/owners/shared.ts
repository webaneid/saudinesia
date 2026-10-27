import { prisma } from '@/lib/db'
import { computeSellPrice } from '../../computeSellPrice'
import type { ResolvedVariant, PriceUnit } from '../types'

// Hari probe netral — Flight/Hotel/Transport/Muthowif tidak day-based, tier HPP selalu flat [{minDays:0,maxDays:9999,cost}] sehingga cocok di hari mana pun.
export const PROBE_DAY = 1

/** Satu varian ("") dari computeSellPrice. Tanpa modal valid (HPP ≤ 0) → modal null + auto null: harga yang sudah ada dipertahankan (perilaku lama "jangan reset ke 0"). */
export async function resolveSingle(ownerType: string, id: string, unit: PriceUnit): Promise<ResolvedVariant[]> {
  const r = await computeSellPrice(ownerType, id, PROBE_DAY)
  if (!r || r.hppRupiah <= 0) {
    return [{ variantKey: '', unit, costIdr: null, autoSellIdr: null, marginPctUsed: null, roundingUsed: null, fxRateIds: [], vendorIds: [] }]
  }
  return [{
    variantKey: '', unit, costIdr: r.hppRupiah, autoSellIdr: r.autoSellPrice,
    // manualSellIdr SENGAJA tidak diisi: harga manual hanya milik titik harga (setManualSell) dan tak pernah ditimpa hitung-ulang.
    marginPctUsed: r.marginPercentUsed, roundingUsed: r.roundingUsed, fxRateIds: r.rateUsed, vendorIds: r.vendorUsed,
  }]
}

/** Modal (rupiah) titik harga milik modul lain, dibaca dari tabel — null bila tak ada / belum lengkap. */
export async function pointCost(ownerType: string, ownerId: string, variantKey = ''): Promise<number | null> {
  const p = await prisma.pricePoint.findUnique({ where: { ownerType_ownerId_variantKey: { ownerType, ownerId, variantKey } }, select: { costIdr: true } })
  return p?.costIdr == null ? null : Number(p.costIdr)
}

/** Modal varian TERMURAH (menurut harga jual) — dasar "mulai dari" untuk Visa. */
export async function cheapestVariantCost(ownerType: string, ownerId: string): Promise<number | null> {
  const p = await prisma.pricePoint.findFirst({ where: { ownerType, ownerId }, orderBy: [{ sellIdr: 'asc' }, { variantKey: 'asc' }], select: { costIdr: true } })
  return p?.costIdr == null ? null : Number(p.costIdr)
}

export const nums = (xs: Array<string | undefined>): string[] => [...new Set(xs.filter((x): x is string => !!x))]
