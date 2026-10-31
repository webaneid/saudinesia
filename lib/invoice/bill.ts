import type { Prisma } from '@prisma/client'

// Tagihan pesanan — SATU pembaca (docs/arsitektur-booking-engine-v2.md §10.4 Fase 6a). `Booking.totalAmount` = Σ snapshot SEBELUM pajak (invarian I4; laporan laba memakainya);
// yang ditagihkan ke pelanggan = itu + pajak yang DITAMBAHKAN (beku di invoice). Halaman, daftar, konfirmasi pembayaran, dan PDF membaca tagihan lewat sini, bukan `totalAmount` langsung.

type Num = number | Prisma.Decimal
export type BillSource = {
  totalAmount: Num
  invoice: { taxAddedIdr: Num; taxIncludedIdr: Num } | null
  payments?: ReadonlyArray<{ status: string; amount: Num }>
}
export type Bill = {
  /** Σ baris harga (sebelum pajak). */
  subtotal: number
  /** Pajak yang ditambahkan ke tagihan. */
  taxAdded: number
  /** Porsi pajak di dalam harga (informasi; sudah termasuk di subtotal). */
  taxIncluded: number
  /** Yang ditagihkan = subtotal + pajak ditambahkan. */
  grandTotal: number
  /** Σ pembayaran terkonfirmasi. */
  paid: number
  /** Sisa (negatif = kelebihan bayar). */
  balance: number
}

const cents = (v: Num | undefined | null) => Math.round(Number(v ?? 0) * 100)

export function billOf(src: BillSource): Bill {
  const subtotal = cents(src.totalAmount)
  const taxAdded = cents(src.invoice?.taxAddedIdr)
  const taxIncluded = cents(src.invoice?.taxIncludedIdr)
  const paid = (src.payments ?? []).filter(p => p.status === 'confirmed').reduce((s, p) => s + cents(p.amount), 0)
  const grand = subtotal + taxAdded
  return { subtotal: subtotal / 100, taxAdded: taxAdded / 100, taxIncluded: taxIncluded / 100, grandTotal: grand / 100, paid: paid / 100, balance: (grand - paid) / 100 }
}

/** Pilihan Prisma minimum untuk `billOf` — dipakai daftar/halaman supaya bentuknya seragam. */
export const billSelect = {
  totalAmount: true,
  invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } },
} satisfies Prisma.BookingSelect
