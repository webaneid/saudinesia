import { addDays, type CalendarDate } from '@/lib/time'

// Murni (aman di klien): tanggal pulang keberangkatan paket = berangkat + durasi − 1 (K1-4: "Paket 9 Hari" berangkat hari 1, pulang hari 9).
// Satu-satunya rumus tanggal pulang paket — halaman detail, checkout, mesin pesan, dan invoice memakainya.
export function packageReturnDate(departureDate: CalendarDate, durationDays: number): CalendarDate {
  return addDays(departureDate, Math.max(1, durationDays) - 1)
}

export const seatsLeft = (d: { totalSeats: number; pendingSeats: number; bookedSeats: number }) =>
  Math.max(0, d.totalSeats - d.pendingSeats - d.bookedSeats)
