import { prisma } from '@/lib/db'
import { computeSellPrice } from './computeSellPrice'

// Hari probe netral — Flight tidak day-based (lihat docs/arsitektur-tiket-pesawat.md §4), tier HPP
// selalu flat [{minDays:0, maxDays:9999, cost}] jadi cocok di hari berapa pun. Bukan angka bisnis.
const PROBE_DAY = 1

/**
 * Refresh cache FlightSchedule.price dari ProductCost (komponen "tiket") jadwal ini.
 * Dipanggil setiap kali ProductCost/PreferredVendor/PricingRule untuk jadwal ini berubah,
 * dan dari refreshAllFlightScheduleCaches() setelah cron kurs jalan.
 * Lihat docs/arsitektur-tiket-pesawat.md §4 dan docs/arsitektur-harga.md §6 (pola yang sama).
 */
export async function refreshFlightScheduleCache(scheduleId: string): Promise<void> {
  const result = await computeSellPrice('flight', scheduleId, PROBE_DAY)
  if (!result || result.hppRupiah <= 0) return // jangan reset ke 0 kalau belum ada komponen HPP valid

  await prisma.flightSchedule.update({
    where: { id: scheduleId },
    data: { price: result.sellPrice },
  })
}

/**
 * Refresh semua FlightSchedule aktif. Kalau `currencies` diberikan (dipanggil dari cron kurs),
 * hanya jadwal yang komponen HPP-nya pakai currency itu yang di-refresh.
 */
export async function refreshAllFlightScheduleCaches(currencies?: string[]): Promise<void> {
  const schedules = await prisma.flightSchedule.findMany({ where: { isActive: true }, select: { id: true } })

  for (const s of schedules) {
    if (currencies && currencies.length > 0) {
      const relevant = await prisma.productCost.findFirst({
        where: { productType: 'flight', productId: s.id, isActive: true, currency: { in: currencies } },
      })
      if (!relevant) continue
    }
    try {
      await refreshFlightScheduleCache(s.id)
    } catch (err) {
      console.error(`[refreshAllFlightScheduleCaches] gagal untuk jadwal ${s.id}:`, err)
    }
  }
}
