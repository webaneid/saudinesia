import { repriceOwner, repriceOwnerType } from './engine'

// Pembungkus tipis (Fase 1 harga terpadu): harga jadwal kamar hotel dihitung & disimpan mesin `lib/pricing/engine` (titik harga `hotel` + penulisan ganda
// ke `HotelRoomSchedule.price`). Nama lama dipertahankan; dihapus di Fase 5.

/** Hitung ulang harga satu jadwal kamar — dipanggil saat ProductCost/PreferredVendor/PricingRule jadwal ini berubah. */
export async function refreshHotelRoomScheduleCache(scheduleId: string): Promise<void> {
  await repriceOwner('hotel', scheduleId)
}

/** Semua jadwal kamar aktif; `currencies` (cron kurs) = hanya yang biayanya memakai mata uang itu. */
export async function refreshAllHotelRoomScheduleCaches(currencies?: string[]): Promise<void> {
  await repriceOwnerType('hotel', currencies)
}
