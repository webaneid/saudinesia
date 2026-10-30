import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient
export type DateRange = { first: Date | null; last: Date | null }

const minOf = (d: Array<Date | null | undefined>): Date | null => d.reduce<Date | null>((a, b) => (b && (!a || b < a) ? b : a), null)
const maxOf = (d: Array<Date | null | undefined>): Date | null => d.reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null)

/** Rentang tanggal semua item booking (paling awal mulai, paling akhir selesai); `null` bila tak ada item bertanggal. */
export async function itemDateRange(tx: Tx, bookingId: string): Promise<DateRange> {
  const where = { bookingId }
  const [hotel, transport, muthowif, catering, tour, flight, haji, pkg] = await Promise.all([
    tx.bookingHotel.aggregate({ where, _min: { checkIn: true }, _max: { checkOut: true } }),
    tx.bookingTransport.aggregate({ where, _min: { travelDate: true }, _max: { travelDate: true } }),
    tx.bookingMuthowif.aggregate({ where, _min: { startDate: true }, _max: { endDate: true } }),
    tx.bookingCatering.aggregate({ where, _min: { startDate: true }, _max: { endDate: true } }),
    tx.bookingTourPackage.aggregate({ where, _min: { tourDate: true }, _max: { tourDate: true } }),
    tx.bookingFlight.aggregate({ where, _min: { departureDate: true }, _max: { departureDate: true } }),
    tx.bookingHaji.findMany({ where, select: { hajiProduct: { select: { departureDate: true, returnDate: true } } } }),
    tx.bookingPackage.aggregate({ where, _min: { departureDate: true }, _max: { returnDate: true } }),
  ])
  return {
    first: minOf([hotel._min.checkIn, transport._min.travelDate, muthowif._min.startDate, catering._min.startDate, tour._min.tourDate, flight._min.departureDate, pkg._min.departureDate, ...haji.map(h => h.hajiProduct.departureDate)]),
    last: maxOf([hotel._max.checkOut, transport._max.travelDate, muthowif._max.endDate, catering._max.endDate, tour._max.tourDate, flight._max.departureDate, pkg._max.returnDate, ...haji.map(h => h.hajiProduct.returnDate ?? h.hajiProduct.departureDate)]),
  }
}

/**
 * Hitung ulang tanggal acuan booking (`departureDate` = item paling awal, `returnDate` = item paling akhir) dan simpan. Tanpa item bertanggal, nilai yang ada TIDAK diubah
 * (mis. booking visa saja dari checkout lama membawa tanggal masukan). Dipanggil di dalam transaksi setiap item booking berubah.
 */
export async function recomputeBookingDates(tx: Tx, bookingId: string): Promise<DateRange> {
  const range = await itemDateRange(tx, bookingId)
  if (range.first || range.last) {
    await tx.booking.update({ where: { id: bookingId }, data: { departureDate: range.first, returnDate: range.last } })
  }
  return range
}
