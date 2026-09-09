import { prisma } from '@/lib/db'
import { computeSellPrice } from './computeSellPrice'

type CostTier = { minDays: number; maxDays: number; cost: number }

/**
 * Refresh cache VisaProduct.price & VisaProduct.durationFeeRules dari ProductCost aktif produk ini.
 * Dipanggil setiap kali ProductCost/PreferredVendor/PricingRule untuk produk ini berubah,
 * dan dari refreshAllVisaProductCaches() setelah cron kurs jalan. Lihat docs/arsitektur-harga.md §6, §17.
 *
 * VisaProduct.price = harga TERMURAH di antara semua tier durationFeeRules (bukan probe hari
 * tertentu) — supaya "harga mulai dari" di katalog publik selalu jujur, tidak tergantung tier
 * mana yang kebetulan mencakup hari tertentu. Kalau durationFeeRules kosong (belum ada komponen
 * HPP valid), price TIDAK diupdate — biarkan nilai lama, bukan direset ke 0.
 */
export async function refreshVisaProductCache(productId: string): Promise<void> {
  const components = await prisma.productCost.findMany({
    where: { productType: 'visa', productId, isActive: true },
  })

  const boundaries = new Map<string, { minDays: number; maxDays: number }>()
  for (const c of components) {
    const tiers = c.costTiers as unknown as CostTier[]
    for (const t of tiers) {
      boundaries.set(`${t.minDays}-${t.maxDays}`, { minDays: t.minDays, maxDays: t.maxDays })
    }
  }

  const durationFeeRules: Array<{ minDays: number; maxDays: number; fee: number }> = []
  for (const { minDays, maxDays } of boundaries.values()) {
    const result = await computeSellPrice('visa', productId, minDays)
    if (result && result.sellPrice > 0) {
      durationFeeRules.push({ minDays, maxDays, fee: result.sellPrice })
    }
  }

  await prisma.visaProduct.update({
    where: { id: productId },
    data: {
      ...(durationFeeRules.length > 0
        ? { price: Math.min(...durationFeeRules.map(r => r.fee)) }
        : {}),
      durationFeeRules,
    },
  })
}

/**
 * Refresh semua VisaProduct aktif. Kalau `currencies` diberikan (dipanggil dari cron kurs),
 * hanya produk yang punya komponen HPP dengan currency itu yang di-refresh — hindari
 * refresh semua produk kalau cuma satu currency yang baru berubah.
 */
export async function refreshAllVisaProductCaches(currencies?: string[]): Promise<void> {
  const products = await prisma.visaProduct.findMany({ where: { isActive: true }, select: { id: true } })

  for (const p of products) {
    if (currencies && currencies.length > 0) {
      const relevant = await prisma.productCost.findFirst({
        where: { productType: 'visa', productId: p.id, isActive: true, currency: { in: currencies } },
      })
      if (!relevant) continue
    }
    try {
      await refreshVisaProductCache(p.id)
    } catch (err) {
      console.error(`[refreshAllVisaProductCaches] gagal untuk produk ${p.id}:`, err)
    }
  }
}
