import { PRICE_OWNER_TYPES, repriceAll } from './engine'

// Satu pintu hitung ulang SEMUA harga jual — dipakai cron kurs (hanya produk ber-biaya mata uang yang berubah) dan perubahan aturan margin (SEMUA produk).
// Sejak Fase 1 harga terpadu ini hanya meneruskan ke mesin `lib/pricing/engine` (delapan langkah `refresh*` kembar kini satu mesin; urutan dasar → komposit
// ada di registry pemilik). Nama dipertahankan agar pemanggil lama tak berubah.

export const PRICE_CACHE_STEP_NAMES: readonly string[] = PRICE_OWNER_TYPES

/** Mengembalikan tipe pemilik yang ada kegagalannya (kosong = semua berhasil). Satu kegagalan tidak menghentikan yang lain. */
export function refreshAllPricingCaches(currencies?: string[]): Promise<string[]> {
  return repriceAll(currencies)
}
