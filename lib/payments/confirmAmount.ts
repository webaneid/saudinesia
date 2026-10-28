import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'

// Jumlah pembayaran yang dikonfirmasi admin (docs/arsitektur-harga-terpadu.md §20, 7A). Unggah bukti membuat `Payment.amount = 0` ("admin memverifikasi jumlah sebenarnya") dan
// konfirmasi dulu TIDAK PERNAH menetapkannya — laporan untung (dibayar/terealisasi) membaca jumlah ini. Aturan: bawaan = total booking; KURANG dari total ditolak (konfirmasi menjamin kuota dan
// menampilkan invoice lunas — kurang bayar bukan untuk dikonfirmasi: tolak dan minta pelunasan, atau sesuaikan total lewat diskon bercatatan sebelum pembayaran); LEBIH dari total wajib bercatatan.

export class PaymentAmountError extends Error {
  constructor(message: string) { super(message); this.name = 'PaymentAmountError' }
}
export const MIN_PAYMENT_NOTE_LENGTH = 3

/** Jumlah akhir yang disimpan untuk konfirmasi. `amount` kosong → total booking. Kurang dari total → ditolak; lebih dari total → `notes` ≥ 3 karakter. */
export function resolveConfirmedAmount(totalAmount: number, input: { amount?: number | null; notes?: string | null }): number {
  const amount = input.amount ?? totalAmount
  if (!Number.isFinite(amount) || amount <= 0) throw new PaymentAmountError('Jumlah pembayaran harus lebih dari 0')
  if (amount > MAX_PRICE_IDR) throw new PaymentAmountError('Jumlah pembayaran melebihi batas wajar')
  const rounded = Math.round(amount * 100) / 100
  const total = Math.round(totalAmount * 100) / 100
  if (rounded < total) throw new PaymentAmountError('Jumlah kurang dari total pesanan — tidak dapat dikonfirmasi. Tolak pembayaran dan minta pelunasan, atau atur ulang total harga jual sebelum pembayaran.')
  if (rounded > total && (input.notes?.trim().length ?? 0) < MIN_PAYMENT_NOTE_LENGTH) {
    throw new PaymentAmountError('Jumlah yang dikonfirmasi lebih dari total pesanan — isi catatan (minimal 3 karakter)')
  }
  return rounded
}
