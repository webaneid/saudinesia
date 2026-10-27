import { prisma } from '@/lib/db'

/** Kunci baris aturan margin GLOBAL (default untuk semua tipe produk). Sentinel non-NULL, supaya `@@unique([productType])` benar-benar menjamin satu baris. */
export const GLOBAL_RULE_KEY = 'global'
/** Satu-satunya tempat nilai bawaan aturan margin (dulu ditulis keras di tiga file). Dipakai bila baris aturan belum ada. */
export const DEFAULT_MARGIN_PERCENT = 20
export const DEFAULT_ROUNDING_INCREMENT = 50000

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

/** Aturan margin untuk satu tipe produk: override tipe itu, kalau tidak ada → baris global. */
export function getMarginRule(productType: string) {
  return prisma.pricingRule.findFirst({ where: { productType } })
    .then(override => override ?? prisma.pricingRule.findFirst({ where: { productType: GLOBAL_RULE_KEY } }))
}

/** Aturan margin yang SIAP PAKAI (angka biasa, nilai bawaan terisi) — pemakai rumus harga cukup memanggil ini. */
export async function resolveMarginRule(productType: string): Promise<{ defaultMarginPercent: number; roundingIncrement: number }> {
  const rule = await getMarginRule(productType)
  return {
    defaultMarginPercent: rule ? Number(rule.defaultMarginPercent) : DEFAULT_MARGIN_PERCENT,
    roundingIncrement: rule ? rule.roundingIncrement : DEFAULT_ROUNDING_INCREMENT,
  }
}
