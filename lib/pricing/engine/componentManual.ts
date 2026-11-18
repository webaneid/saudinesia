import type { prisma } from '@/lib/db'

// Harga manual per Komponen Biaya (titik `cost_component`, docs/arsitektur-harga-terpadu.md §22) — dibaca di dalam mesin harga (`manualSellIdr` milik mesin,
// dijaga scripts/test-price-manual.ts). Tanpa impor lain dari mesin: dipakai `lib/pricing/costComponents.ts`, yang juga diimpor pemilik komposit (hindari impor melingkar).
export async function componentManualSells(db: Pick<typeof prisma, 'pricePoint'>, costIds: string[]): Promise<Map<string, number>> {
  if (costIds.length === 0) return new Map()
  const rows = await db.pricePoint.findMany({
    where: { ownerType: 'cost_component', ownerId: { in: costIds }, variantKey: '', manualSellIdr: { not: null } },
    select: { ownerId: true, manualSellIdr: true },
  })
  return new Map(rows.map(p => [p.ownerId, Number(p.manualSellIdr)]))
}
