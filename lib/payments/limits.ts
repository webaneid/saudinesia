// Batas nominal pembayaran bertahap (Fase 7a, docs/arsitektur-booking-engine-v2.md §10.7, keputusan P1–P3). Murni — dipakai formulir pelanggan
// (pratinjau), route unggah (di dalam kunci booking), dan verifikasi admin. Satuan rupiah; dihitung dalam sen supaya tak ada galat pecahan.

export type PaymentLimits = {
  /** Sisa tagihan = batas atas satu pembayaran pelanggan. */
  balance: number
  /** DP minimum dalam rupiah (persen setelan × tagihan, dibulatkan ke atas). 0 = tak ada aturan DP. */
  dpAmount: number
  /** Kursi dikonfirmasi bila terbayar terverifikasi mencapai ini (P1/P3: DP, atau pembayaran pertama berapa pun bila DP 0%). */
  confirmThreshold: number
  /** Terbayar terverifikasi sudah memenuhi ambang konfirmasi. */
  dpMet: boolean
  /** Nominal terkecil yang boleh diisi pelanggan sekarang (P2): sisa menuju DP bila belum terpenuhi, selain itu Rp 1. Tak pernah melebihi `balance`. */
  minClaim: number
}

const cents = (n: number) => Math.round(n * 100)

export function paymentLimits(bill: { grandTotal: number; paid: number }, minimumFirstPaymentPercent: number): PaymentLimits {
  const total = cents(bill.grandTotal)
  const paid = cents(bill.paid)
  const balance = Math.max(0, total - paid)
  const pct = Math.min(100, Math.max(0, minimumFirstPaymentPercent))
  // Ke atas ke rupiah penuh: DP tak pernah kurang dari persen yang diatur.
  const dp = pct > 0 ? Math.min(total, Math.ceil((total * pct) / 100 / 100) * 100) : 0
  const threshold = dp > 0 ? dp : 1 // DP 0%: satu sen terbayar pun cukup (pembayaran pertama berapa pun)
  const dpMet = paid >= threshold
  const minClaim = Math.min(balance, dpMet ? 100 : Math.max(100, dp - paid))
  return { balance: balance / 100, dpAmount: dp / 100, confirmThreshold: threshold / 100, dpMet, minClaim: minClaim / 100 }
}
