import type { BookingTourPackage } from '@prisma/client'
import { confirmHotelQuota, releaseHotelQuota } from '@/lib/quota'
import { confirmTransportQuota, releaseTransportQuota } from '@/lib/quota'
import type { QuotaAdapter } from './types'

// Paket Ziarah TIDAK punya kuota sendiri — reuse TransportQuota (kendaraan, mode included/
// user_choice) dan HotelRoomSchedule (hotel mode user_choice saja, mode included statis di
// template, sengaja tidak reservasi — docs/arsitektur-ziarah.md §10.7/§12.6). Adapter ini
// membungkus logic yang sudah ada di bookings/route.ts dkk, bukan menulis ulang.
export const tourPackageAdapter: QuotaAdapter<BookingTourPackage> = {
  confirm: async (tx, row) => {
    if (row.transportQuotaId) await confirmTransportQuota(tx, row.transportQuotaId, row.numPeople)
    if (row.chosenHotelRoomScheduleId && row.chosenHotelNumRooms) {
      await confirmHotelQuota(tx, row.chosenHotelRoomScheduleId, row.chosenHotelNumRooms)
    }
  },
  release: async (tx, row, o) => {
    if (row.transportQuotaId) await releaseTransportQuota(tx, row.transportQuotaId, row.numPeople, o.confirmed)
    if (row.chosenHotelRoomScheduleId && row.chosenHotelNumRooms) {
      await releaseHotelQuota(tx, row.chosenHotelRoomScheduleId, row.chosenHotelNumRooms, o.confirmed)
    }
  },
}
