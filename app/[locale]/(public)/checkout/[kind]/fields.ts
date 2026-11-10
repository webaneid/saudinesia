import type { CheckoutInput } from '@/lib/validators/checkout'
import { formatRupiah } from '@/lib/utils'
import { daysBetween, formatCalendarDate, isCalendarDate } from '@/lib/time'
import { entryPeople } from '@/lib/validators/checkout'

/** Isian per jenis melaporkan masukan checkout yang LENGKAP (atau null) + petunjuk isian yang masih kurang. */
export type FieldsChange = (input: CheckoutInput | null, missing: string | null) => void

/** Opsi ChoiceSelect dengan harga jual sebagai petunjuk di kanan (0 = tanpa angka). */
export const priceHint = (n: number, unit = ''): string | undefined => (n > 0 ? `${formatRupiah(n)}${unit}` : undefined)

/**
 * Rentang hari layanan (muthowif, katering): nilai mentah isian tanggal → tanggal sah + jumlah hari (termasuk hari mulai dan selesai, aturan mesin)
 * + petunjuk yang masih kurang. Nilai setengah diketik (mis. tahun "0002") dianggap kosong — tak pernah dihitung (lib/time menolak).
 */
export function serviceDays(rawStart: string, rawEnd: string, today: string, maxDays: number) {
  const start = isCalendarDate(rawStart) ? rawStart : ''
  const end = isCalendarDate(rawEnd) ? rawEnd : ''
  const days = start && end ? daysBetween(start, end) + 1 : 0
  const missing = !start || !end ? 'Pilih tanggal mulai dan selesai'
    : start < today ? 'Tanggal mulai tidak boleh sebelum hari ini'
    : days < 1 ? 'Tanggal selesai tidak boleh sebelum tanggal mulai'
    : days > maxDays ? `Maksimal ${maxDays} hari per pesanan` : null
  return { start, end, days, missing }
}

const day = (d: string) => formatCalendarDate(d)

/** Ringkasan satu baris pilihan pesanan untuk kartu keranjang (tanggal + jumlah orang) — tanpa harga, tanpa data pribadi. */
export function entrySummary(c: CheckoutInput): string {
  const people = `${entryPeople(c)} orang`
  switch (c.kind) {
    case 'package': return `Berangkat ${day(c.departureDate)} · ${people}`
    case 'visa': return `Rencana berangkat ${day(c.plannedTravelDate)}${c.selectedDurationDays ? ` · ${c.selectedDurationDays}+ hari` : ''} · ${people}`
    case 'transport': return people
    case 'haji': return people
    case 'hotel': return `${day(c.checkIn)} – ${day(c.checkOut)} · ${c.numRooms} kamar · ${people}`
    case 'tour': return `${day(c.tourDate)} · ${people}`
    case 'muthowif': case 'catering': return `${day(c.startDate)} – ${day(c.endDate)} · ${people}`
    case 'flight': return `Pergi ${day(c.departureDate)}${c.returnDate ? ` · pulang ${day(c.returnDate)}` : ''} · ${people}`
  }
}
