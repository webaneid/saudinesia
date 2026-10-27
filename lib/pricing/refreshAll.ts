import { refreshAllVisaProductCaches } from './refreshVisaProductCache'
import { refreshAllFlightScheduleCaches } from './refreshFlightScheduleCache'
import { refreshAllHotelRoomScheduleCaches } from './refreshHotelRoomScheduleCache'
import { refreshAllTransportPricingCaches } from './refreshTransportPricingCache'
import { refreshAllMuthowifServicePriceCaches } from './refreshMuthowifServicePriceCache'
import { refreshAllTourPackagePriceCaches } from './refreshTourPackagePriceCache'
import { refreshAllPackagePriceCaches } from './refreshPackagePriceCache'
import { refreshAllHajiPriceCaches } from './computeHajiPrice'

// SATU daftar semua cache harga jual — dipakai cron kurs (hanya produk ber-biaya mata uang yang berubah) dan perubahan aturan margin (SEMUA produk).
// Sebelumnya cron punya delapan blok try/catch sendiri sedangkan perubahan margin hanya menyegarkan Visa (docs/arsitektur-harga-terpadu.md §1.2-10):
// harga Hotel/Pesawat/Transport/Muthowif/Paket/Haji bisa basi diam-diam. Urutan WAJIB: modul dasar dulu, komposit (paket, haji) terakhir karena
// membaca harga modul dasar. Fase 1 (`PricePoint`) menggantikan seluruh daftar ini dengan satu mesin.
const STEPS: ReadonlyArray<{ name: string; run: (currencies?: string[]) => Promise<void> }> = [
  { name: 'visa', run: refreshAllVisaProductCaches },
  { name: 'flight', run: refreshAllFlightScheduleCaches },
  { name: 'hotel', run: refreshAllHotelRoomScheduleCaches },
  { name: 'transport', run: refreshAllTransportPricingCaches },
  { name: 'muthowif', run: refreshAllMuthowifServicePriceCaches },
  { name: 'paket ziarah', run: refreshAllTourPackagePriceCaches },
  { name: 'paket umroh', run: refreshAllPackagePriceCaches },
  { name: 'haji', run: refreshAllHajiPriceCaches },
]

export const PRICE_CACHE_STEP_NAMES = STEPS.map(s => s.name)

/** Segarkan semua cache harga jual. `currencies` diberikan = hanya produk yang biayanya memakai mata uang itu; kosong = semua produk. Satu langkah gagal tidak menghentikan yang lain; mengembalikan nama langkah yang gagal. */
export async function refreshAllPricingCaches(currencies?: string[]): Promise<string[]> {
  const failed: string[] = []
  for (const step of STEPS) {
    try {
      await step.run(currencies)
    } catch (err) {
      failed.push(step.name)
      console.error(`[pricing] refresh cache harga ${step.name} gagal:`, err)
    }
  }
  return failed
}
