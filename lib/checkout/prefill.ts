import { isCalendarDate, type CalendarDate } from '@/lib/time'
import type { CheckoutKind } from './kinds'

// Isian awal checkout dari kotak cari katalog (docs/arsitektur-frontend-publik.md §9 H2/H3): pelanggan memilih tanggal/jumlah di katalog, halaman checkout
// terbuka sudah terisi. MURNI — dipakai katalog (membuat tautan), halaman checkout (membaca), dan penyaring jalur kembali login (lib/auth/nextPath.ts).
// Isian awal hanya PETUNJUK untuk formulir: halaman checkout tetap memeriksa periode/kursi/kamar, dan mesin pesan memeriksa ulang semuanya.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const COUNT_RE = /^[1-9]\d{0,2}$/

export type FlightPrefill = { date?: CalendarDate; pax?: number; ret?: string; retDate?: CalendarDate }
export type HotelPrefill = { room?: string; checkIn?: CalendarDate; checkOut?: CalendarDate; rooms?: number; guests?: number }
export type PackagePrefill = { departure?: string; pax?: number }
export type CheckoutPrefill = FlightPrefill | HotelPrefill | PackagePrefill

type Kind = 'date' | 'count' | 'uuid'
/** Kunci per jenis, dalam URUTAN kanonik (urutan ini juga yang diterima jalur kembali login). */
export const PREFILL_KEYS = {
  flight: [['date', 'date'], ['pax', 'count'], ['ret', 'uuid'], ['retDate', 'date']],
  // Paket Umroh (K1): keberangkatan dari halaman detail paket — tetap diperiksa terhadap daftar keberangkatan yang bisa dipilih.
  package: [['departure', 'uuid'], ['pax', 'count']],
  hotel: [['room', 'uuid'], ['checkIn', 'date'], ['checkOut', 'date'], ['rooms', 'count'], ['guests', 'count']],
} as const satisfies Partial<Record<CheckoutKind, ReadonlyArray<readonly [string, Kind]>>>

type PrefillKind = keyof typeof PREFILL_KEYS
const hasPrefill = (k: CheckoutKind): k is PrefillKind => k in PREFILL_KEYS

const valid = (kind: Kind, v: string) => (kind === 'date' ? isCalendarDate(v) : kind === 'count' ? COUNT_RE.test(v) : UUID_RE.test(v))

/** Isian awal yang sah dari parameter URL; kunci asing atau nilai tak sah DIABAIKAN (bukan galat). */
export function readPrefill(kind: CheckoutKind, sp: Record<string, string | string[] | undefined>): Record<string, string | number> {
  if (!hasPrefill(kind)) return {}
  const out: Record<string, string | number> = {}
  for (const [key, type] of PREFILL_KEYS[kind]) {
    const v = sp[key]
    if (typeof v === 'string' && valid(type, v)) out[key] = type === 'count' ? Number(v) : v
  }
  return out
}

/** Bagian query isian awal dalam urutan kanonik (`&date=…&pax=…`), atau '' — nilai tak sah dibuang. */
export function prefillQuery(kind: CheckoutKind, prefill: Record<string, string | number | undefined> | undefined): string {
  if (!prefill || !hasPrefill(kind)) return ''
  let q = ''
  for (const [key, type] of PREFILL_KEYS[kind]) {
    const v = prefill[key]
    if (v !== undefined && valid(type, String(v))) q += `&${key}=${String(v)}`
  }
  return q
}
