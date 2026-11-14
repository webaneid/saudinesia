import type { CalendarDate } from '@/lib/time'
import { packageReturnDate } from './dates'

// Peringatan editor keberangkatan (K1, docs/arsitektur-paket-umroh.md §8.4) — MURNI dan hanya MENGINGATKAN admin, tak pernah menolak
// (penolakan sungguhan tetap di mesin pesan: tanggal di luar periode tiket/hotel → 422). Teks untuk admin (bahasa Indonesia).

export type PeriodRule = {
  /** "Tiket Garuda CGK–JED" / "Hotel Makkah: Hilton". */
  label: string
  from: CalendarDate
  to: CalendarDate
  /** `departure` = hanya tanggal berangkat di periode (jadwal tiket); `stay` = seluruh berangkat–pulang di periode (hotel). */
  covers: 'departure' | 'stay'
}

export type DepartureWarnings = { package: string[]; byDeparture: Record<string, string[]> }

export function departureWarnings(input: {
  durationDays: number | null
  /** Σ malam hotel `included` (Makkah + Madinah). */
  includedNights: number
  periods: PeriodRule[]
  departures: ReadonlyArray<{ id: string; departureDate: CalendarDate; isActive: boolean }>
}): DepartureWarnings {
  const pkg: string[] = []
  const { durationDays } = input
  if (!durationDays) pkg.push('Durasi paket belum diisi — keberangkatan belum bisa dipesan.')
  else if (input.includedNights > durationDays - 1) {
    pkg.push(`Total malam hotel (${input.includedNights}) melebihi durasi paket − 1 (${durationDays - 1} malam).`)
  }
  if (input.departures.length > 0 && !input.departures.some(d => d.isActive)) pkg.push('Tidak ada keberangkatan aktif — paket tidak bisa dipesan.')
  const byDeparture: Record<string, string[]> = {}
  for (const d of input.departures) {
    const back = durationDays ? packageReturnDate(d.departureDate, durationDays) : d.departureDate
    const out = input.periods.filter(p => d.departureDate < p.from || (p.covers === 'stay' ? back : d.departureDate) > p.to)
      .map(p => `Di luar periode ${p.label} (${p.from} s.d. ${p.to}).`)
    if (out.length > 0) byDeparture[d.id] = out
  }
  return { package: pkg, byDeparture }
}
