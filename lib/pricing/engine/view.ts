import type { Prisma } from '@prisma/client'
import type { PriceOwnerType, PriceUnit, PriceView } from './types'

const num = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d))

export function toView(p: { ownerType: string; ownerId: string; variantKey: string; unit: string; costIdr: Prisma.Decimal | null; sellIdr: Prisma.Decimal; manualSellIdr: Prisma.Decimal | null; autoSellIdr?: Prisma.Decimal | null; manualNote?: string | null; manualAt?: Date | null }): PriceView {
  const cost = num(p.costIdr)
  const sell = Number(p.sellIdr)
  return {
    ownerType: p.ownerType as PriceOwnerType, ownerId: p.ownerId, variantKey: p.variantKey, unit: p.unit as PriceUnit,
    costIdr: cost, sellIdr: sell,
    profitIdr: cost == null ? null : sell - cost,
    marginPct: cost == null || cost <= 0 ? null : ((sell - cost) / cost) * 100,
    mode: p.manualSellIdr != null ? 'manual' : 'auto',
    autoSellIdr: num(p.autoSellIdr ?? null),
    manualNote: p.manualNote ?? null,
    manualAt: p.manualAt ?? null,
  }
}
