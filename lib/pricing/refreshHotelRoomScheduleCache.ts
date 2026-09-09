import { prisma } from '@/lib/db'
import { computeSellPrice } from './computeSellPrice'

// Hari probe netral — Hotel tidak day-based (docs/arsitektur-hotel.md §10.4), tier HPP selalu flat
// [{minDays:0, maxDays:9999, cost}] jadi cocok di hari berapa pun. Bukan angka bisnis.
const PROBE_DAY = 1

/**
 * Refresh cache HotelRoomSchedule.price dari ProductCost (komponen "kamar") jadwal ini.
 * Dipanggil setiap kali ProductCost/PreferredVendor/PricingRule untuk jadwal ini berubah,
 * dan dari refreshAllHotelRoomScheduleCaches() setelah cron kurs jalan.
 * Lihat docs/arsitektur-hotel.md §10.4 dan docs/arsitektur-harga.md §6 (pola yang sama).
 */
export async function refreshHotelRoomScheduleCache(scheduleId: string): Promise<void> {
  const result = await computeSellPrice('hotel', scheduleId, PROBE_DAY)
  if (!result || result.hppRupiah <= 0) return // jangan reset ke 0 kalau belum ada komponen HPP valid

  await prisma.hotelRoomSchedule.update({
    where: { id: scheduleId },
    data: { price: result.sellPrice },
  })
}

/**
 * Refresh semua HotelRoomSchedule aktif. Kalau `currencies` diberikan (dipanggil dari cron kurs),
 * hanya jadwal yang komponen HPP-nya pakai currency itu yang di-refresh.
 */
export async function refreshAllHotelRoomScheduleCaches(currencies?: string[]): Promise<void> {
  const schedules = await prisma.hotelRoomSchedule.findMany({ where: { isActive: true }, select: { id: true } })

  for (const s of schedules) {
    if (currencies && currencies.length > 0) {
      const relevant = await prisma.productCost.findFirst({
        where: { productType: 'hotel', productId: s.id, isActive: true, currency: { in: currencies } },
      })
      if (!relevant) continue
    }
    try {
      await refreshHotelRoomScheduleCache(s.id)
    } catch (err) {
      console.error(`[refreshAllHotelRoomScheduleCaches] gagal untuk jadwal ${s.id}:`, err)
    }
  }
}
