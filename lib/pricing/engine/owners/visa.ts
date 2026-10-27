import { prisma } from '@/lib/db'
import { computeSellPrice } from '../../computeSellPrice'
import type { PriceOwner, ResolvedVariant } from '../types'

type CostTier = { minDays: number; maxDays: number }

export const visaVariantKey = (minDays: number, maxDays: number) => `days:${minDays}-${maxDays}`
const parseVariantKey = (key: string) => {
  const m = /^days:(\d+)-(\d+)$/.exec(key)
  return m ? { minDays: Number(m[1]), maxDays: Number(m[2]) } : null
}

// Visa: harga per RENTANG HARI (tier). Satu varian per batas tier unik dari semua komponen biaya; modal = HPP pada hari awal rentang. Override jual per tier
// (JSON biaya, `sellPriceOverride`) ikut sebagai harga manual varian itu. Kolom lama: `durationFeeRules` (JSON per tier) + `price` = harga termurah ("mulai dari").
export const visaOwner: PriceOwner = {
  ownerType: 'visa', dependsOnOthers: false, prunes: true,
  listIds: async () => (await prisma.visaProduct.findMany({ where: { isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.visaProduct.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),

  resolve: async id => {
    const components = await prisma.productCost.findMany({ where: { productType: 'visa', productId: id, isActive: true } })
    const boundaries = new Map<string, { minDays: number; maxDays: number }>()
    for (const c of components) {
      for (const t of c.costTiers as unknown as CostTier[]) boundaries.set(`${t.minDays}-${t.maxDays}`, { minDays: t.minDays, maxDays: t.maxDays })
    }
    const out: ResolvedVariant[] = []
    for (const { minDays, maxDays } of boundaries.values()) {
      const r = await computeSellPrice('visa', id, minDays)
      if (!r || r.sellPrice <= 0) continue
      out.push({
        variantKey: visaVariantKey(minDays, maxDays), unit: 'person',
        costIdr: r.hppRupiah, autoSellIdr: r.autoSellPrice, manualSellIdr: r.sellPriceOverride,
        marginPctUsed: r.marginPercentUsed, roundingUsed: r.roundingUsed, fxRateIds: r.rateUsed, vendorIds: r.vendorUsed,
      })
    }
    return out
  },

  adoptLegacy: async () => null, // varian Visa hanya lahir dari tier biaya — tak ada harga lama tanpa modal untuk dipungut

  writeLegacy: async (tx, id, stored) => {
    const durationFeeRules = stored.flatMap(v => {
      const range = parseVariantKey(v.variantKey)
      return range ? [{ ...range, fee: v.sellIdr }] : []
    })
    await tx.visaProduct.update({
      where: { id },
      data: { ...(durationFeeRules.length > 0 ? { price: Math.min(...durationFeeRules.map(r => r.fee)) } : {}), durationFeeRules },
    })
  },
}
