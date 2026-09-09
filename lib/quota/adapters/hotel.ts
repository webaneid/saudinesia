import type { BookingHotel } from '@prisma/client'
import { reserveHotelQuota, confirmHotelQuota, releaseHotelQuota } from '@/lib/quota'
import type { QuotaAdapter } from './types'

export const hotelAdapter: QuotaAdapter<BookingHotel> = {
  confirm: (tx, row) => confirmHotelQuota(tx, row.hotelRoomScheduleId, row.numRooms),
  release: (tx, row) => releaseHotelQuota(tx, row.hotelRoomScheduleId, row.numRooms),
}

// reserve() dipanggil SEBELUM baris BookingHotel ada — argumennya nilai mentah, bukan row.
export const reserveHotel = reserveHotelQuota
