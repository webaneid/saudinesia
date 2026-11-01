import { formatCalendarDate, type CalendarDate } from '@/lib/time'

// Pemilih hotel di form booking admin (docs/arsitektur-hotel.md §12.6): Jenis → Hotel → Kamar, PERIODE dipilih otomatis dari tanggal menginap.
// Murni (aman di klien). Masukan = opsi katalog `bookingCatalog('hotel')` (satu baris per jadwal kamar = hotel × tipe kamar × periode, HANYA harga jual).

export type HotelScheduleOpt = {
  id: string; hotelId: string; hotelName: string; city: string; stars: number | null
  roomTypeId: string; roomType: string; capacity: number
  from: string; to: string; roomsLeft: number; price: number
}
export type HotelChoice = { id: string; name: string; city: string; stars: number | null }
export type RoomChoice = { id: string; name: string; capacity: number; minPrice: number; maxPrice: number }
export type PeriodRange = { from: string; to: string }
export type HotelResolve =
  | { ok: true; schedule: HotelScheduleOpt }
  | { ok: false; reason: 'incomplete' | 'no_period'; periods: PeriodRange[] }

/** Hotel unik (bukan per jadwal), urut nama. */
export function hotelsOf(opts: readonly HotelScheduleOpt[]): HotelChoice[] {
  const m = new Map<string, HotelChoice>()
  for (const o of opts) if (!m.has(o.hotelId)) m.set(o.hotelId, { id: o.hotelId, name: o.hotelName, city: o.city, stars: o.stars })
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'id') || a.id.localeCompare(b.id))
}

/** Tipe kamar satu hotel (unik), urut kapasitas, dengan rentang harga jual lintas periodenya. */
export function roomsOf(opts: readonly HotelScheduleOpt[], hotelId: string): RoomChoice[] {
  const m = new Map<string, RoomChoice>()
  for (const o of opts) {
    if (o.hotelId !== hotelId) continue
    const r = m.get(o.roomTypeId)
    if (r) { r.minPrice = Math.min(r.minPrice, o.price); r.maxPrice = Math.max(r.maxPrice, o.price) } else m.set(o.roomTypeId, { id: o.roomTypeId, name: o.roomType, capacity: o.capacity, minPrice: o.price, maxPrice: o.price })
  }
  return [...m.values()].sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name, 'id'))
}

/** Periode tersedia untuk satu kamar (urut tanggal). */
export function periodsOf(opts: readonly HotelScheduleOpt[], hotelId: string, roomTypeId: string): PeriodRange[] {
  return opts.filter(o => o.hotelId === hotelId && o.roomTypeId === roomTypeId).map(o => ({ from: o.from, to: o.to })).sort((a, b) => a.from.localeCompare(b.from))
}

/**
 * Jadwal kamar untuk tanggal menginap: periode yang mencakup SELURUH malam — aturan sama dengan mesin pesan (`lib/booking/lineItems.ts`: check-in ≥ awal periode,
 * check-out ≤ akhir periode). Menginap lintas dua periode tidak terpecah otomatis → `no_period` (pesan menyebut periode yang tersedia).
 */
export function resolveHotelSchedule(opts: readonly HotelScheduleOpt[], hotelId: string, roomTypeId: string, checkIn: string, checkOut: string): HotelResolve {
  const periods = hotelId && roomTypeId ? periodsOf(opts, hotelId, roomTypeId) : []
  if (!hotelId || !roomTypeId || !checkIn || !checkOut || checkOut <= checkIn) return { ok: false, reason: 'incomplete', periods }
  const hit = opts.find(o => o.hotelId === hotelId && o.roomTypeId === roomTypeId && o.from <= checkIn && checkOut <= o.to)
  return hit ? { ok: true, schedule: hit } : { ok: false, reason: 'no_period', periods }
}

/** Pesan untuk baris tanpa periode yang mencakup tanggalnya. */
export function noPeriodMessage(periods: readonly PeriodRange[]): string {
  if (periods.length === 0) return 'Belum ada harga untuk kamar ini'
  const list = periods.map(p => `${formatCalendarDate(p.from as CalendarDate)} – ${formatCalendarDate(p.to as CalendarDate)}`).join('; ')
  return `Tidak ada harga kamar ini untuk tanggal tersebut (seluruh malam harus dalam satu periode). Periode tersedia: ${list}`
}
