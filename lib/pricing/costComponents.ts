import type { ProductCost } from '@prisma/client'
import { prisma } from '@/lib/db'
import { componentManualSells } from './engine/componentManual'
import { getLatestRate, resolveMarginRule, roundToNearest, type MarginRule } from './pricingHelpers'

// Komponen Biaya bebas — satu-satunya tempat baris `ProductCost` diubah menjadi HPP + harga jual PER KOMPONEN
// (docs/arsitektur-komponen-biaya.md). Sebelumnya blok ini ditulis identik di computePackagePrice dan computeTourPackagePrice.
// Sejak §22 docs/arsitektur-harga-terpadu.md: tiap komponen punya titik harga `cost_component` (ownerId = ProductCost.id) — harga jual manual komponen
// (bila ada) MENGGANTIKAN rekomendasinya; rekomendasi (HPP × margin) tetap dihitung di sini dan tak pernah ikut tergeser oleh harga manual.

type CostTier = { minDays: number; maxDays: number; cost: number }

// Flat, tidak day-based — sama alasan Flight/Muthowif/Transport/Ziarah (docs/arsitektur-paket-umroh.md §5).
const PROBE_DAY = 1

/** Pemilik Komponen Biaya yang harga komponennya bisa diatur manual (Visa juga memakai `ProductCost`, tapi lewat tier — bukan di sini). */
export const COMPOSITE_COST_TYPES = ['package', 'tour_package', 'haji'] as const
export type CompositeCostType = (typeof COMPOSITE_COST_TYPES)[number]
export const isCompositeCostType = (t: string): t is CompositeCostType => (COMPOSITE_COST_TYPES as readonly string[]).includes(t)

export type ComponentBreakdown = {
  /** ProductCost.id — kunci baris snapshot harga (nama komponen boleh kembar antar vendor) dan `ownerId` titik harga `cost_component`. */
  costId: string
  costComponent: string
  vendorId: string
  currency: string
  /** null = HPP tak bisa dihitung (kurs/tier tak ada) tetapi komponen tetap ikut karena berharga manual — modal produk jadi "belum lengkap". */
  hppRupiah: number | null
  /** Harga jual yang BERLAKU = harga manual komponen ?? rekomendasi. */
  sellPrice: number
  /** Rekomendasi = HPP × (1 + margin tipe produk) dibulatkan; null bila HPP tak bisa dihitung. */
  autoSellPrice: number | null
  mode: 'auto' | 'manual'
  /** ExchangeRate.id yang membentuk HPP (kosong untuk IDR) — jejak untuk mesin harga. */
  rateId?: string
}

/** Koneksi baca — `prisma` atau klien transaksi (jalur pesan membekukan hasilnya ke snapshot di dalam transaksi, SEC-212). */
export type CostComponentsDb = Pick<typeof prisma, 'productCost' | 'pricingRule' | 'exchangeRate' | 'revenueShareSetting' | 'user' | 'pricePoint'>

export type CostComponentsResult = { components: ComponentBreakdown[]; totalSellPrice: number; totalAutoSellPrice: number }

/** HPP + rekomendasi SATU komponen; null bila tak ada tier yang cocok atau kurs tak ditemukan (komponen dilewati, bukan error total). */
export async function componentAuto(c: Pick<ProductCost, 'currency' | 'costTiers'>, rule: Pick<MarginRule, 'defaultMarginPercent' | 'roundingIncrement'>, db: Pick<typeof prisma, 'exchangeRate'> = prisma): Promise<{ hppRupiah: number; autoSellPrice: number; rateId?: string } | null> {
  const tiers = c.costTiers as unknown as CostTier[]
  const tier = tiers.find(t => PROBE_DAY >= t.minDays && PROBE_DAY <= t.maxDays)
  if (!tier) return null
  let hppRupiah: number
  let rateId: string | undefined
  if (c.currency === 'IDR') {
    hppRupiah = tier.cost
  } else {
    const rate = await getLatestRate(c.currency, 'IDR', db)
    if (!rate) return null // kurs tidak ditemukan — skip komponen ini, bukan error total
    hppRupiah = tier.cost * Number(rate.sellRate)
    rateId = rate.id
  }
  return { hppRupiah, autoSellPrice: roundToNearest(hppRupiah * (1 + rule.defaultMarginPercent / 100), rule.roundingIncrement), rateId }
}

/**
 * HPP (kurs) → margin tipe produk → pembulatan, PER KOMPONEN, lalu dijumlah. Harga manual komponen (titik `cost_component`) menggantikan rekomendasinya.
 * Komponen tanpa tier yang cocok atau tanpa kurs dilewati (bukan error total) — perilaku sama dengan implementasi lama.
 */
export async function computeCostComponents(productType: string, productId: string, db: CostComponentsDb = prisma): Promise<CostComponentsResult> {
  const costs = await db.productCost.findMany({ where: { productType, productId, isActive: true }, orderBy: { id: 'asc' } })
  const rule = await resolveMarginRule(productType, db)
  const manual = isCompositeCostType(productType) ? await componentManualSells(db, costs.map(c => c.id)) : new Map<string, number>()

  const components: ComponentBreakdown[] = []
  for (const c of costs) {
    const a = await componentAuto(c, rule, db)
    const m = manual.get(c.id)
    // Tanpa HPP (kurs/tier tak ada) komponen dilewati — KECUALI admin sudah memberinya harga jual: harga itu tetap ikut total (tak pernah hilang diam-diam).
    if (!a && m == null) continue
    components.push({
      costId: c.id, costComponent: c.costComponent, vendorId: c.vendorId, currency: c.currency, hppRupiah: a?.hppRupiah ?? null,
      sellPrice: m ?? a!.autoSellPrice, autoSellPrice: a?.autoSellPrice ?? null, mode: m != null ? 'manual' : 'auto', rateId: a?.rateId,
    })
  }

  return {
    components,
    totalSellPrice: components.reduce((sum, c) => sum + c.sellPrice, 0),
    totalAutoSellPrice: components.reduce((sum, c) => sum + (c.autoSellPrice ?? c.sellPrice), 0), // tanpa rekomendasi → harga berlakunya (aturan `lineFromPoint`)
  }
}
