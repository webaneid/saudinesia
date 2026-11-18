import { prisma } from '@/lib/db'
import { effectiveRevenueShare } from '@/lib/revenue-share/settings'

/** Kunci baris aturan margin GLOBAL (default untuk semua tipe produk). Sentinel non-NULL, supaya `@@unique([productType])` benar-benar menjamin satu baris. */
export const GLOBAL_RULE_KEY = 'global'
/** Satu-satunya tempat nilai bawaan aturan margin (dulu ditulis keras di tiga file). Dipakai bila baris aturan belum ada. */
export const DEFAULT_MARGIN_PERCENT = 20
export const DEFAULT_ROUNDING_INCREMENT = 50000

export function roundToNearest(value: number, increment: number): number {
  if (increment <= 0) return value
  return Math.round(value / increment) * increment
}

// `db` di fungsi-fungsi berikut = klien transaksi bila dipanggil di dalam transaksi (SEC-212): jangan mengambil koneksi pool kedua.
export function getLatestRate(fromCurrency: string, toCurrency: string, db: Pick<typeof prisma, 'exchangeRate'> = prisma) {
  return db.exchangeRate.findFirst({
    where: { fromCurrency, toCurrency },
    orderBy: { fetchedAt: 'desc' },
  })
}

/** Aturan margin untuk satu tipe produk: override tipe itu, kalau tidak ada → baris global. */
export function getMarginRule(productType: string, db: Pick<typeof prisma, 'pricingRule'> = prisma) {
  return db.pricingRule.findFirst({ where: { productType } })
    .then(override => override ?? db.pricingRule.findFirst({ where: { productType: GLOBAL_RULE_KEY } }))
}

export type MarginRule = {
  /** Margin yang DIPAKAI rumus harga otomatis = margin klien + poin Platform Provider (opsi markup). Semua rumus harga memakai angka ini. */
  defaultMarginPercent: number
  /** Margin aturan klien (PricingRule) saja — untuk tampilan. */
  clientMarginPercent: number
  /** Poin marjin milik Platform Provider (docs/arsitektur-bagi-hasil.md P3 opsi 2); 0 bila dasar = margin atau belum ada akun Platform Provider aktif. */
  providerMarkupPercent: number
  roundingIncrement: number
}

/** Aturan margin yang SIAP PAKAI (angka biasa, nilai bawaan terisi) — pemakai rumus harga cukup memanggil ini. Satu-satunya tempat poin Platform Provider masuk ke harga. */
export async function resolveMarginRule(productType: string, db: Pick<typeof prisma, 'pricingRule' | 'revenueShareSetting' | 'user'> = prisma): Promise<MarginRule> {
  const rule = await getMarginRule(productType, db)
  const share = await effectiveRevenueShare(db) // berurutan: `db` bisa klien transaksi
  const clientMarginPercent = rule ? Number(rule.defaultMarginPercent) : DEFAULT_MARGIN_PERCENT
  const providerMarkupPercent = share?.basis === 'markup' ? share.percent : 0
  return {
    defaultMarginPercent: clientMarginPercent + providerMarkupPercent, clientMarginPercent, providerMarkupPercent,
    roundingIncrement: rule ? rule.roundingIncrement : DEFAULT_ROUNDING_INCREMENT,
  }
}
