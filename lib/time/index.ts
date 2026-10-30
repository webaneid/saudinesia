// SATU pintu waktu aplikasi (docs/arsitektur-booking-engine-v2.md §5, aturan wajib di CLAUDE.md "Waktu & zona waktu").
// Murni — tanpa dependensi, tanpa Prisma/next/*; aman di server dan klien. Hasil TIDAK bergantung pada zona proses/peramban (diuji di beberapa `TZ`).
//
// Dua jenis nilai waktu, jangan dicampur:
//  • INSTAN (`Date` dari kolom timestamp — createdAt, paidAt, requestedAt): satu titik waktu absolut. Disimpan UTC; "hari ini", batas hari, dan tampilan
//    dihitung di ZONA APLIKASI (`getAppTimezone()`).
//  • TANGGAL KALENDER (kolom `@db.Date` — departureDate, checkIn, tourDate): tanggal di tempat kejadian, tanpa jam/zona. Di aplikasi berupa string `YYYY-MM-DD`;
//    `Date` dari Prisma (UTC tengah malam) hanya dibaca lewat `calendarDateOf`/`formatCalendarDate`, tak pernah lewat getter lokal (`getDate()`/`setHours()`).

/** Zona bawaan (sebelum setelan dimuat). */
export const DEFAULT_APP_TIMEZONE = 'Asia/Jakarta'

// Zona aplikasi = setelan "Pengaturan Invoice → Waktu" (docs/arsitektur-booking-engine-v2.md §6, Fase 2). Satu nilai per proses (satu replika, satu operator):
// dimuat saat boot dan diperbarui saat setelan disimpan di server (`lib/invoice/settings.ts`), dan diset di klien lewat `AppTimezoneProvider`. Semua fungsi menerima `tz` opsional.
// Disimpan di `globalThis` (pola singleton Prisma/`_cronStarted`): Next 15 dapat memuat modul ini lebih dari sekali di proses yang sama (instrumentation, route handler, halaman RSC);
// satu nilai bersama memastikan setelan yang disimpan/dimuat terlihat oleh semuanya (SEC-110).
const G = globalThis as typeof globalThis & { __appTimezone?: string }
export const getAppTimezone = (): string => G.__appTimezone ?? DEFAULT_APP_TIMEZONE
/** Nama zona IANA yang dikenal runtime ("Asia/Jakarta", "America/Los_Angeles"…). */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}
/** Nama zona KANONIK yang boleh DISIMPAN sebagai setelan: terdaftar di runtime (`Intl.supportedValuesOf`) atau "UTC"; bentuk offset ("+07:00", "GMT+7") ditolak — Postgres menafsirkannya lain (SEC-114). */
export function isCanonicalTimezone(tz: unknown): tz is string {
  if (!isValidTimezone(tz) || /^[+-]?\d|^(GMT|UTC)[+-]/i.test(tz)) return false
  if (tz === 'UTC') return true
  const list = typeof Intl.supportedValuesOf === 'function' ? (Intl.supportedValuesOf('timeZone') as string[]) : null
  return list ? list.includes(tz) : tz.includes('/')
}
/** Ganti zona aplikasi proses ini. Menolak nama yang tak dikenal (zona tak berubah). */
export function setAppTimezone(tz: string): void {
  if (!isValidTimezone(tz)) throw new RangeError(`Zona waktu tidak dikenal: ${String(tz)}`)
  G.__appTimezone = tz
}

export type CalendarDate = string // 'YYYY-MM-DD'
const CAL_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

// ── tanggal kalender (string) ──────────────────────────────────────────────────────────────────────────────────────────
/** `YYYY-MM-DD` yang benar-benar ada di kalender (tolak 2026-02-30). */
export function isCalendarDate(s: unknown): s is CalendarDate {
  if (typeof s !== 'string') return false
  const m = CAL_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}
function assertCal(s: string): void {
  if (!isCalendarDate(s)) throw new RangeError(`Bukan tanggal kalender YYYY-MM-DD: ${String(s)}`)
}
const calToUtcMs = (s: CalendarDate): number => { assertCal(s); return Date.parse(`${s}T00:00:00Z`) }
const utcMsToCal = (ms: number): CalendarDate => new Date(ms).toISOString().slice(0, 10)

/** Tambah (atau kurangi) hari pada tanggal kalender — aritmetika murni kalender, tak terpengaruh DST/zona. */
export function addDays(s: CalendarDate, n: number): CalendarDate { return utcMsToCal(calToUtcMs(s) + n * DAY_MS) }
/** Selisih hari kalender `b − a` (bilangan bulat, bisa negatif). */
export function daysBetween(a: CalendarDate, b: CalendarDate): number { return Math.round((calToUtcMs(b) - calToUtcMs(a)) / DAY_MS) }
/** Tiap tanggal dari `start` sampai `end` (inklusif). */
export function* eachDay(start: CalendarDate, end: CalendarDate): Generator<CalendarDate> {
  for (let d = start; d <= end; d = addDays(d, 1)) yield d
}
/** Kolom `@db.Date` dari Prisma (UTC tengah malam) → `YYYY-MM-DD`. */
export function calendarDateOf(d: Date): CalendarDate {
  if (Number.isNaN(d.getTime())) throw new RangeError('Tanggal tidak valid')
  return utcMsToCal(d.getTime())
}
/** `YYYY-MM-DD` → nilai untuk kolom `@db.Date` (UTC tengah malam). */
export function dbDateOf(s: CalendarDate): Date { return new Date(calToUtcMs(s)) }
/** Bilangan tahun/bulan dari tanggal kalender. */
export const yearOf = (s: CalendarDate): number => { assertCal(s); return Number(s.slice(0, 4)) }

// ── instan ↔ zona ──────────────────────────────────────────────────────────────────────────────────────────────────────
const parts = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = parts.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    parts.set(tz, f)
  }
  return f
}
export type WallClock = { y: number; mo: number; d: number; h: number; mi: number; s: number }
/** Jam dinding (tahun…detik) dari satu instan di zona `tz`. */
export function wallClockOf(instant: Date | number, tz: string = getAppTimezone()): WallClock {
  const ms = typeof instant === 'number' ? instant : instant.getTime()
  if (Number.isNaN(ms)) throw new RangeError('Instan tidak valid')
  const p: Record<string, number> = {}
  for (const x of partsFormatter(tz).formatToParts(ms)) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! }
}
/** Selisih (ms) jam dinding `tz` terhadap UTC pada instan itu (WIB = +7 jam, Riyadh = +3, Los Angeles = −7/−8). */
export function offsetMsAt(instant: number, tz: string = getAppTimezone()): number {
  const w = wallClockOf(instant, tz)
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(instant / 1000) * 1000
}
/** Instan yang jam dindingnya di `tz` adalah nilai itu (kebalikan `wallClockOf`; benar melewati batas DST). */
export function instantFromWallClock(w: { y: number; mo: number; d: number; h?: number; mi?: number; s?: number }, tz: string = getAppTimezone()): Date {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h ?? 0, w.mi ?? 0, w.s ?? 0)
  const off1 = offsetMsAt(guess, tz)
  let t = guess - off1
  const off2 = offsetMsAt(t, tz)
  if (off2 !== off1) t = guess - off2
  return new Date(t)
}
/** Tanggal kalender di zona aplikasi untuk satu instan ("hari ini" = `dateInApp(new Date())`). */
export function dateInApp(instant: Date | number = new Date(), tz: string = getAppTimezone()): CalendarDate {
  const w = wallClockOf(instant, tz)
  return `${String(w.y).padStart(4, '0')}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`
}
export const todayInApp = (now: Date = new Date(), tz: string = getAppTimezone()): CalendarDate => dateInApp(now, tz)
export const yearInApp = (now: Date = new Date(), tz: string = getAppTimezone()): number => yearOf(dateInApp(now, tz))
/** Awal hari (00:00:00.000) tanggal kalender itu di `tz`, sebagai instan. */
export function startOfDayInApp(day: CalendarDate, tz: string = getAppTimezone()): Date {
  assertCal(day)
  return instantFromWallClock({ y: Number(day.slice(0, 4)), mo: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) }, tz)
}
/** Awal hari BERIKUTNYA di `tz` (batas eksklusif "akhir hari": instan < nilai ini masih hari itu). */
export function endOfDayExclusiveInApp(day: CalendarDate, tz: string = getAppTimezone()): Date { return startOfDayInApp(addDays(day, 1), tz) }

// ── masukan tanggal-jam (formulir) ─────────────────────────────────────────────────────────────────────────────────────
const LOCAL_DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
/** Nilai `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`) DITAFSIRKAN di zona aplikasi (bukan zona peramban) → instan. Tak sah → `null`. */
export function parseAppDateTime(value: string, tz: string = getAppTimezone()): Date | null {
  const m = LOCAL_DT_RE.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)]
  if (!isCalendarDate(`${m[1]}-${m[2]}-${m[3]}`) || h > 23 || mi > 59 || s > 59) return null
  return instantFromWallClock({ y, mo, d, h, mi, s }, tz)
}
/** Instan → nilai `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`) menurut zona aplikasi. */
export function toAppDateTimeInput(instant: Date | number = new Date(), tz: string = getAppTimezone()): string {
  const w = wallClockOf(instant, tz)
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(w.y, 4)}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`
}

// ── tampilan ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const DATE_NUMERIC: Intl.DateTimeFormatOptions = {}
export const DATE_MEDIUM: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
export const DATE_LONG: Intl.DateTimeFormatOptions = { dateStyle: 'long' }
export const DATE_SHORT_MONTH: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
export const DATE_SHORT_MONTH_2D: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }
export const DATETIME_MEDIUM: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
export const DATETIME_LONG: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeStyle: 'short' }
export const DATETIME_FULL: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'short' }

type DateInput = Date | string | number
const toDate = (v: DateInput): Date => {
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) throw new RangeError('Tanggal/instan tidak valid')
  return d
}
/** Tampilkan INSTAN di zona aplikasi (selalu `timeZone` eksplisit). Bahasa Indonesia. */
export function formatInstant(value: DateInput, options: Intl.DateTimeFormatOptions = DATE_MEDIUM, tz: string = getAppTimezone()): string {
  const withTime = 'timeStyle' in options || 'hour' in options || 'minute' in options
  const d = toDate(value)
  return withTime ? d.toLocaleString('id-ID', { ...options, timeZone: tz }) : d.toLocaleDateString('id-ID', { ...options, timeZone: tz })
}
/** Tampilkan TANGGAL KALENDER (`@db.Date`, `YYYY-MM-DD`, atau ISO dari JSON kolom itu) — tak bergeser oleh zona mana pun. Bahasa Indonesia. */
export function formatCalendarDate(value: Date | CalendarDate | string, options: Intl.DateTimeFormatOptions = DATE_MEDIUM): string {
  // String dari JSON kolom `@db.Date` berbentuk ISO ("2026-11-01T00:00:00.000Z"): tanggalnya adalah 10 karakter pertama (UTC tengah malam), bukan zona pembaca.
  const d = typeof value === 'string' ? dbDateOf(value.slice(0, 10)) : toDate(value)
  return d.toLocaleDateString('id-ID', { ...options, timeZone: 'UTC' })
}
/** Singkatan zona untuk label formulir/tampilan: WIB/WITA/WIT untuk zona Indonesia, selain itu "GMT+3". */
export function zoneLabel(tz: string = getAppTimezone(), at: Date = new Date()): string {
  if (tz === 'Asia/Jakarta' || tz === 'Asia/Pontianak') return 'WIB'
  if (tz === 'Asia/Makassar') return 'WITA'
  if (tz === 'Asia/Jayapura') return 'WIT'
  const o = Math.round(offsetMsAt(at.getTime(), tz) / 60_000)
  const sign = o < 0 ? '-' : '+'
  const abs = Math.abs(o)
  return `GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`
}
