import { prisma } from '@/lib/db'
import { resolveMarginRule } from '../../pricingHelpers'
import { COMPOSITE_COST_TYPES, componentAuto, isCompositeCostType } from '../../costComponents'
import type { PriceOwner } from '../types'
import { hajiOwner, packageOwner, tourPackageOwner } from './composite'

// Satu komponen Komponen Biaya (Haji, Paket Umroh, Paket Ziarah) sebagai pemilik harga (docs/arsitektur-harga-terpadu.md §22): ownerId = `ProductCost.id`,
// modal = HPP komponen, otomatis = rekomendasi (HPP × margin tipe produk induk), harga manual opsional lewat `setManualSell`. Harga produk induk = Σ harga
// berlaku komponennya (`computeCostComponents`), jadi perubahan di sini selalu diikuti hitung ulang induk (`parent`).

const PARENT_OWNERS = { package: packageOwner, tour_package: tourPackageOwner, haji: hajiOwner } as const
const SCOPE = { productType: { in: [...COMPOSITE_COST_TYPES] } }

export const costComponentOwner: PriceOwner = {
  ownerType: 'cost_component', unit: 'package', creatableVariants: [{ key: '', unit: 'package' }],
  // Bukan karena membaca modul lain: `idsUsingCurrencies` menyaring per `ProductCost.productType` (= induk), jadi komponen selalu dihitung ulang semuanya.
  dependsOnOthers: true, prunes: false,
  listIds: async () => (await prisma.productCost.findMany({ where: { ...SCOPE, isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.productCost.findMany({ where: { ...SCOPE, id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => {
    const rows = await prisma.productCost.findMany({ where: { ...SCOPE, id: { in: ids } }, select: { id: true, costComponent: true, productType: true, productId: true } })
    const out = new Map<string, { label: string; href: string }>()
    for (const type of COMPOSITE_COST_TYPES) {
      const mine = rows.filter(r => r.productType === type)
      if (mine.length === 0) continue
      const parents = await PARENT_OWNERS[type].describe([...new Set(mine.map(r => r.productId))])
      for (const r of mine) {
        const p = parents.get(r.productId)
        out.set(r.id, { label: `${r.costComponent} — ${p?.label ?? 'produk'}`, href: p?.href ?? '' })
      }
    }
    return out
  },
  resolve: async id => {
    const c = await prisma.productCost.findUnique({ where: { id }, select: { productType: true, currency: true, costTiers: true, vendorId: true } })
    if (!c || !isCompositeCostType(c.productType)) return []
    const rule = await resolveMarginRule(c.productType)
    const a = await componentAuto(c, rule)
    return [{
      variantKey: '', unit: 'package',
      costIdr: a?.hppRupiah ?? null, autoSellIdr: a?.autoSellPrice ?? null, // tanpa tier/kurs → harga tersimpan dipertahankan (aturan repriceOwner)
      marginPctUsed: rule.defaultMarginPercent, roundingUsed: rule.roundingIncrement,
      fxRateIds: a?.rateId ? [a.rateId] : [], vendorIds: [c.vendorId],
    }]
  },
  parent: async id => {
    const c = await prisma.productCost.findUnique({ where: { id }, select: { productType: true, productId: true } })
    return c && isCompositeCostType(c.productType) ? { ownerType: c.productType, ownerId: c.productId } : null
  },
}
