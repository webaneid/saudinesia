import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'

// Jumlah yang diverifikasi admin untuk SATU pembayaran (Fase 7a F3, docs/arsitektur-booking-engine-v2.md §10.7; dulu §20 7A "harus = total").
// Bawaan = nominal yang diisi pelanggan (`claimedAmountIdr`), bila tak ada = sisa tagihan. KURANG dari sisa = cicilan/DP, diperbolehkan
// (P2: admin boleh mengonfirmasi jumlah berapa pun — peringatan DP hanya di UI). LEBIH dari sisa = kelebihan bayar, wajib bercatatan (refund manual, D11).

export class PaymentAmountError extends Error {
  constructor(message: string) { super(message); this.name = 'PaymentAmountError' }
}
export const MIN_PAYMENT_NOTE_LENGTH = 3

const cents = (n: number) => Math.round(n * 100)

/** Jumlah akhir yang disimpan. `amount` kosong → `claimed` → `balance`. Harus > 0; lebih dari sisa → `notes` ≥ 3 karakter. */
export function resolveVerifiedAmount(balance: number, claimed: number | null, input: { amount?: number | null; notes?: string | null }): number {
  const amount = input.amount ?? claimed ?? balance
  if (!Number.isFinite(amount) || amount <= 0) throw new PaymentAmountError('Jumlah pembayaran harus lebih dari 0')
  if (amount > MAX_PRICE_IDR) throw new PaymentAmountError('Jumlah pembayaran melebihi batas wajar')
  const rounded = cents(amount) / 100
  if (cents(rounded) > cents(Math.max(0, balance)) && (input.notes?.trim().length ?? 0) < MIN_PAYMENT_NOTE_LENGTH) {
    throw new PaymentAmountError('Jumlah yang dikonfirmasi lebih dari sisa tagihan — isi catatan (minimal 3 karakter)')
  }
  return rounded
}
