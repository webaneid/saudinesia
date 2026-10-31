import type { Prisma } from '@prisma/client'

export type Tx = Prisma.TransactionClient

// Confirm/release beroperasi atas baris per-tipe yang SUDAH DIBUAT (BookingHotel dkk, Opsi B —
// docs/arsitektur-booking.md §5) — bukan tabel BookingItem polimorfik tunggal (Opsi A, belum
// dieksekusi). Setiap adapter tahu field mana yang relevan dari baris tipenya sendiri.
export type ReleaseOpts = {
  /** Booking sudah dikonfirmasi → kuota ada di `booked*`, bukan `pending*`. */
  confirmed: boolean
}
export type QuotaAdapter<TRow> = {
  confirm: (tx: Tx, row: TRow) => Promise<void>
  release: (tx: Tx, row: TRow, opts: ReleaseOpts) => Promise<void>
}
