import { repriceOwner, repriceOwnerType } from './engine'

// Pembungkus tipis (Fase 1 harga terpadu): perhitungan & penyimpanan harga Tiket Pesawat kini milik mesin `lib/pricing/engine`
// (titik harga `flight` + penulisan ganda ke `FlightSchedule.price`). Nama lama dipertahankan agar semua pemicu yang ada tetap sama;
// dihapus di Fase 5 bersama kolom lama.

/** Hitung ulang harga satu jadwal penerbangan — dipanggil saat ProductCost/PreferredVendor/PricingRule jadwal ini berubah. */
export async function refreshFlightScheduleCache(scheduleId: string): Promise<void> {
  await repriceOwner('flight', scheduleId)
}

/** Semua jadwal aktif; `currencies` (cron kurs) = hanya yang biayanya memakai mata uang itu. */
export async function refreshAllFlightScheduleCaches(currencies?: string[]): Promise<void> {
  await repriceOwnerType('flight', currencies)
}
