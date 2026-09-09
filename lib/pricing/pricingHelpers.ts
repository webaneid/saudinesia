import { prisma } from '@/lib/db'

export function roundToNearest(value: number, increment: number): number {
  if (increment <= 0) return value
  return Math.round(value / increment) * increment
}

export function getLatestRate(fromCurrency: string, toCurrency: string) {
  return prisma.exchangeRate.findFirst({
    where: { fromCurrency, toCurrency },
    orderBy: { fetchedAt: 'desc' },
  })
}

export function getMarginRule(productType: string) {
  return prisma.pricingRule.findFirst({ where: { productType } })
    .then(override => override ?? prisma.pricingRule.findFirst({ where: { productType: null } }))
}
