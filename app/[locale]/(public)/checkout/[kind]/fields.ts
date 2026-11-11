import type { CheckoutInput } from '@/lib/validators/checkout'
import { formatRupiah } from '@/lib/utils'
import { daysBetween, formatCalendarDate, isCalendarDate } from '@/lib/time'
import { entryPeople } from '@/lib/validators/checkout'

/** Isian per jenis melaporkan masukan checkout yang LENGKAP (atau null) + petunjuk isian yang masih kurang (teks sudah diterjemahkan). */
export type FieldsChange = (input: CheckoutInput | null, missing: string | null) => void

/** Opsi ChoiceSelect dengan harga jual sebagai petunjuk di kanan (0 = tanpa angka). `unit` = teks satuan yang sudah diterjemahkan. */
export const priceHint = (n: number, unit = ''): string | undefined => (n > 0 ? `${formatRupiah(n)}${unit}` : undefined)

/** Isian rentang hari yang masih kurang — kunci `checkout.days.*`. */
export type DaysMissing = 'pickDates' | 'startPast' | 'endBeforeStart' | 'tooLong'

/**
 * Rentang hari layanan (muthowif, katering): nilai mentah isian tanggal → tanggal sah + jumlah hari (termasuk hari mulai dan selesai, aturan mesin)
 * + kunci petunjuk yang masih kurang. Nilai setengah diketik (mis. tahun "0002") dianggap kosong — tak pernah dihitung (lib/time menolak).
 */
export function serviceDays(rawStart: string, rawEnd: string, today: string, maxDays: number) {
  const start = isCalendarDate(rawStart) ? rawStart : ''
  const end = isCalendarDate(rawEnd) ? rawEnd : ''
  const days = start && end ? daysBetween(start, end) + 1 : 0
  const missing: DaysMissing | null = !start || !end ? 'pickDates'
    : start < today ? 'startPast'
    : days < 1 ? 'endBeforeStart'
    : days > maxDays ? 'tooLong' : null
  return { start, end, days, missing }
}

/** Ringkasan satu baris pilihan pesanan — kunci `checkout.entry.*` + nilainya (tanggal sudah diformat dalam bahasa halaman). */
export type EntrySummary = { key: 'package' | 'visa' | 'visaDuration' | 'people' | 'hotel' | 'tour' | 'range' | 'flight' | 'flightReturn'; values: Record<string, string | number> }

/** Ringkasan satu baris pilihan pesanan untuk kartu keranjang (tanggal + jumlah orang) — tanpa harga, tanpa data pribadi. */
export function entrySummary(c: CheckoutInput, locale: string): EntrySummary {
  const day = (d: string) => formatCalendarDate(d, undefined, locale)
  const people = entryPeople(c)
  switch (c.kind) {
    case 'package': return { key: 'package', values: { date: day(c.departureDate), people } }
    case 'visa': return c.selectedDurationDays
      ? { key: 'visaDuration', values: { date: day(c.plannedTravelDate), days: c.selectedDurationDays, people } }
      : { key: 'visa', values: { date: day(c.plannedTravelDate), people } }
    case 'transport': case 'haji': return { key: 'people', values: { people } }
    case 'hotel': return { key: 'hotel', values: { checkIn: day(c.checkIn), checkOut: day(c.checkOut), rooms: c.numRooms, people } }
    case 'tour': return { key: 'tour', values: { date: day(c.tourDate), people } }
    case 'muthowif': case 'catering': return { key: 'range', values: { start: day(c.startDate), end: day(c.endDate), people } }
    case 'flight': return c.returnDate
      ? { key: 'flightReturn', values: { date: day(c.departureDate), returnDate: day(c.returnDate), people } }
      : { key: 'flight', values: { date: day(c.departureDate), people } }
  }
}
