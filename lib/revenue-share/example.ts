import type { RevenueShareBasis } from '@prisma/client'

// Contoh hitung bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md §1 P3) — MURNI, aman di klien (pratinjau setelan) dan server.
// markup (opsi 2): jual = modal × (1 + (margin + persen) ÷ 100); bagian Platform Provider = modal × persen ÷ 100; margin klien utuh.
// margin (opsi 1): jual = modal × (1 + margin ÷ 100); bagian Platform Provider = (jual − modal) × persen ÷ 100; diambil dari margin klien.
// Tanpa pembulatan harga (pembulatan per produk milik mesin harga) — hanya ilustrasi angka.

export type RevenueShareExample = { costIdr: number; marginPercent: number; sellIdr: number; providerIdr: number; clientIdr: number }

const r2 = (n: number) => Math.round(n * 100) / 100

export function revenueShareExample(percent: number, basis: RevenueShareBasis, costIdr = 1_000_000, marginPercent = 20): RevenueShareExample {
  if (basis === 'markup') {
    const providerIdr = r2(costIdr * percent / 100)
    const clientIdr = r2(costIdr * marginPercent / 100)
    return { costIdr, marginPercent, sellIdr: r2(costIdr + clientIdr + providerIdr), providerIdr, clientIdr }
  }
  const margin = r2(costIdr * marginPercent / 100)
  const providerIdr = r2(margin * percent / 100)
  return { costIdr, marginPercent, sellIdr: r2(costIdr + margin), providerIdr, clientIdr: r2(margin - providerIdr) }
}

export const REVENUE_SHARE_BASIS_LABEL: Record<RevenueShareBasis, string> = {
  markup: 'Tambah poin marjin',
  margin: 'Bagi dari margin',
}
