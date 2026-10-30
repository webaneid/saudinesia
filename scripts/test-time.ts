// Modul waktu (docs/arsitektur-booking-engine-v2.md §5): tabel nilai dihitung tangan. DIJALANKAN di bawah beberapa `TZ` (lihat package.json) — hasil HARUS identik di
// UTC, Asia/Jakarta, Asia/Riyadh, dan America/Los_Angeles; itulah inti jaminannya (tanggal tak boleh bergeser oleh zona server/peramban). Tanpa database.
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCancellationPolicy } from '@/lib/utils/cancellationPolicy'
import {
  DEFAULT_APP_TIMEZONE, DATETIME_LONG, DATETIME_MEDIUM, DATE_LONG, DATE_MEDIUM, DATE_NUMERIC,
  addDays, calendarDateOf, getAppTimezone, isCanonicalTimezone, isValidTimezone, setAppTimezone, dateInApp, daysBetween, dbDateOf, eachDay, endOfDayExclusiveInApp, formatCalendarDate, formatInstant, instantFromWallClock,
  isCalendarDate, offsetMsAt, parseAppDateTime, startOfDayInApp, toAppDateTimeInput, todayInApp, wallClockOf, yearInApp, zoneLabel,
} from '@/lib/time'

const expectedOffsetMin: Record<string, number> = { UTC: 0, 'Asia/Jakarta': -420, 'Asia/Riyadh': -180, 'America/Los_Angeles': 420 } // getTimezoneOffset pada 2026-01-15 (PST di LA: 480)
const tzEnv = process.env.TZ ?? '(kosong)'
let failed = 0
const pending: Promise<void>[] = []
function t(name: string, fn: () => void | Promise<void>) {
  const bad = (e: unknown) => { failed++; console.log(`FAIL [${tzEnv}] ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
  try {
    const r = fn()
    if (r instanceof Promise) pending.push(r.then(() => console.log(`PASS [${tzEnv}] ${name}`)).catch(bad))
    else console.log(`PASS [${tzEnv}] ${name}`)
  } catch (e) { bad(e) }
}
const iso = (d: Date) => d.toISOString()

t('matriks TZ sungguhan: zona proses = TZ yang diminta (kalau tidak, jaminan lintas-zona palsu)', () => {
  const want = tzEnv === 'America/Los_Angeles' ? 480 : expectedOffsetMin[tzEnv]
  assert.ok(want !== undefined, `TZ tak dikenal: ${tzEnv}`)
  assert.equal(new Date('2026-01-15T12:00:00Z').getTimezoneOffset(), want)
})

t('isCalendarDate: hanya tanggal yang ada di kalender (tahun kabisat benar, 30 Februari/bulan 13/format salah ditolak)', () => {
  for (const ok of ['2026-10-30', '2028-02-29', '2026-12-31', '2000-01-01']) assert.equal(isCalendarDate(ok), true, ok)
  for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', '26-10-30', '2026-10-30T00:00', '', 'abc', 20261030, null, undefined]) assert.equal(isCalendarDate(bad), false, String(bad))
})

t('addDays/daysBetween/eachDay (tabel nilai): melewati akhir bulan/tahun/Februari, mundur, nol, dan 25 jam DST tak memengaruhi hari kalender', () => {
  const table: Array<[string, number, string]> = [
    ['2026-10-30', 1, '2026-10-31'], ['2026-10-31', 1, '2026-11-01'], ['2026-12-31', 1, '2027-01-01'], ['2026-03-01', -1, '2026-02-28'],
    ['2028-03-01', -1, '2028-02-29'], ['2026-11-01', 0, '2026-11-01'], ['2026-03-08', 1, '2026-03-09'], ['2026-11-01', 1, '2026-11-02'], ['2026-01-31', 30, '2026-03-02'],
  ]
  for (const [d, n, want] of table) assert.equal(addDays(d, n), want, `${d} ${n >= 0 ? '+' : ''}${n}`)
  assert.equal(daysBetween('2026-10-30', '2026-11-01'), 2)
  assert.equal(daysBetween('2026-11-01', '2026-10-30'), -2)
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2, 'melewati DST Amerika')
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2, 'melewati akhir DST Amerika')
  assert.deepEqual([...eachDay('2026-02-27', '2026-03-02')], ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
  assert.deepEqual([...eachDay('2026-10-30', '2026-10-29')], [])
  assert.throws(() => addDays('2026-02-30', 1), RangeError)
})

t('kolom @db.Date (UTC tengah malam) ↔ string: sama di semua TZ (dulu getDate()/toLocale mundur sehari di zona barat)', () => {
  assert.equal(calendarDateOf(new Date('2026-11-01T00:00:00Z')), '2026-11-01')
  assert.equal(iso(dbDateOf('2026-11-01')), '2026-11-01T00:00:00.000Z')
  assert.equal(calendarDateOf(dbDateOf('2028-02-29')), '2028-02-29')
  assert.throws(() => calendarDateOf(new Date('x')), RangeError)
})

t('formatCalendarDate: tanggal tampil SAMA di semua TZ (1 November tetap 1 November, tidak jadi 31 Oktober di Los Angeles)', () => {
  const d = dbDateOf('2026-11-01')
  assert.equal(formatCalendarDate(d, DATE_MEDIUM), '1 Nov 2026')
  assert.equal(formatCalendarDate(d, DATE_LONG), '1 November 2026')
  assert.equal(formatCalendarDate(d, DATE_NUMERIC), '1/11/2026')
  assert.equal(formatCalendarDate('2026-12-31', DATE_MEDIUM), '31 Des 2026')
  assert.equal(formatCalendarDate('2026-01-01'), '1 Jan 2026')
})

t('dateInApp/todayInApp (tabel nilai WIB): batas tengah malam WIB = 17:00 UTC — 00:00–07:00 WIB sudah hari berikutnya padahal UTC masih kemarin', () => {
  const table: Array<[string, string]> = [
    ['2026-10-29T16:59:59.999Z', '2026-10-29'], ['2026-10-29T17:00:00.000Z', '2026-10-30'], ['2026-10-29T17:30:00Z', '2026-10-30'],
    ['2026-12-31T16:59:59Z', '2026-12-31'], ['2026-12-31T17:00:00Z', '2027-01-01'], ['2026-02-28T17:00:00Z', '2026-03-01'], ['2028-02-28T17:00:00Z', '2028-02-29'],
  ]
  for (const [at, want] of table) assert.equal(dateInApp(new Date(at)), want, at)
  assert.equal(todayInApp(new Date('2026-12-31T17:00:00Z')), '2027-01-01')
  assert.equal(yearInApp(new Date('2026-12-31T16:59:59Z')), 2026)
  assert.equal(yearInApp(new Date('2026-12-31T17:00:00Z')), 2027, 'kode booking tahun baru mulai tepat 00:00 WIB (dulu getFullYear() mengikuti zona server)')
  assert.equal(DEFAULT_APP_TIMEZONE, 'Asia/Jakarta')
  assert.equal(getAppTimezone(), 'Asia/Jakarta')
})

t('zona lain eksplisit: Riyadh (+3) dan Los Angeles (DST −7 → −8 pada 1 Nov 2026) menghitung hari sendiri', () => {
  assert.equal(dateInApp(new Date('2026-10-29T21:00:00Z'), 'Asia/Riyadh'), '2026-10-30')
  assert.equal(dateInApp(new Date('2026-10-29T20:59:59Z'), 'Asia/Riyadh'), '2026-10-29')
  assert.equal(dateInApp(new Date('2026-10-30T06:59:59Z'), 'America/Los_Angeles'), '2026-10-29')
  assert.equal(dateInApp(new Date('2026-10-30T07:00:00Z'), 'America/Los_Angeles'), '2026-10-30')
  assert.equal(dateInApp(new Date('2026-11-02T07:59:59Z'), 'America/Los_Angeles'), '2026-11-01', 'setelah DST berakhir offset −8')
  assert.equal(dateInApp(new Date('2026-11-02T08:00:00Z'), 'America/Los_Angeles'), '2026-11-02')
  assert.equal(offsetMsAt(Date.parse('2026-10-30T00:00:00Z'), 'Asia/Jakarta'), 7 * 3_600_000)
  assert.equal(offsetMsAt(Date.parse('2026-10-30T00:00:00Z'), 'America/Los_Angeles'), -7 * 3_600_000)
  assert.equal(offsetMsAt(Date.parse('2026-11-02T00:00:00Z'), 'America/Los_Angeles'), -8 * 3_600_000)
})

t('startOfDayInApp/endOfDayExclusiveInApp: batas hari di zona aplikasi (WIB) dan hari 25 jam di Los Angeles', () => {
  assert.equal(iso(startOfDayInApp('2026-10-30')), '2026-10-29T17:00:00.000Z')
  assert.equal(iso(endOfDayExclusiveInApp('2026-10-30')), '2026-10-30T17:00:00.000Z')
  assert.equal(iso(startOfDayInApp('2026-11-01', 'America/Los_Angeles')), '2026-11-01T07:00:00.000Z')
  assert.equal(iso(endOfDayExclusiveInApp('2026-11-01', 'America/Los_Angeles')), '2026-11-02T08:00:00.000Z', '1 Nov 2026 di LA = 25 jam')
  assert.equal(iso(startOfDayInApp('2026-03-08', 'America/Los_Angeles')), '2026-03-08T08:00:00.000Z')
  assert.equal(iso(endOfDayExclusiveInApp('2026-03-08', 'America/Los_Angeles')), '2026-03-09T07:00:00.000Z', '8 Mar 2026 di LA = 23 jam')
  assert.throws(() => startOfDayInApp('2026-02-30'), RangeError)
})

t('parseAppDateTime/toAppDateTimeInput: masukan datetime-local ditafsirkan di zona APLIKASI, bukan zona peramban; bolak-balik utuh; tak sah → null', () => {
  assert.equal(iso(parseAppDateTime('2026-10-30T09:24')!), '2026-10-30T02:24:00.000Z')
  assert.equal(iso(parseAppDateTime('2026-10-30T00:30')!), '2026-10-29T17:30:00.000Z')
  assert.equal(iso(parseAppDateTime('2026-10-30T09:24:15')!), '2026-10-30T02:24:15.000Z')
  assert.equal(iso(parseAppDateTime('2026-10-30T09:24', 'Asia/Riyadh')!), '2026-10-30T06:24:00.000Z')
  assert.equal(iso(parseAppDateTime('2026-03-08T01:30', 'America/Los_Angeles')!), '2026-03-08T09:30:00.000Z')
  assert.equal(iso(parseAppDateTime('2026-03-08T03:30', 'America/Los_Angeles')!), '2026-03-08T10:30:00.000Z')
  assert.equal(iso(parseAppDateTime('2026-11-01T12:00', 'America/Los_Angeles')!), '2026-11-01T20:00:00.000Z')
  for (const bad of ['', 'abc', '2026-02-30T10:00', '2026-10-30T24:00', '2026-10-30T10:60', '2026-10-30', '2026-10-30 10:00', '2026-13-01T10:00']) assert.equal(parseAppDateTime(bad), null, bad)
  assert.equal(toAppDateTimeInput(new Date('2026-10-30T02:24:00Z')), '2026-10-30T09:24')
  assert.equal(toAppDateTimeInput(new Date('2026-10-29T17:00:00Z')), '2026-10-30T00:00', 'tengah malam WIB tampil 00:00, bukan 24:00')
  for (const v of ['2026-10-30T09:24', '2026-12-31T23:59', '2027-01-01T00:00', '2028-02-29T12:00']) assert.equal(toAppDateTimeInput(parseAppDateTime(v)!), v, v)
  const at = new Date('2026-10-30T02:24:00Z')
  assert.equal(iso(parseAppDateTime(toAppDateTimeInput(at, 'America/Los_Angeles'), 'America/Los_Angeles')!), iso(at))
})

t('wallClockOf/instantFromWallClock: kebalikan satu sama lain', () => {
  const w = wallClockOf(new Date('2026-10-30T02:24:15Z'))
  assert.deepEqual(w, { y: 2026, mo: 10, d: 30, h: 9, mi: 24, s: 15 })
  assert.equal(iso(instantFromWallClock(w)), '2026-10-30T02:24:15.000Z')
  assert.deepEqual(wallClockOf(new Date('2026-10-29T17:00:00Z')), { y: 2026, mo: 10, d: 30, h: 0, mi: 0, s: 0 }, 'jam 00, bukan 24')
})

t('formatInstant: selalu zona aplikasi (dulu mengikuti zona server/peramban); format sama dengan pemakaian lama', () => {
  const at = new Date('2026-10-29T17:30:00Z')
  assert.equal(formatInstant(at, DATE_MEDIUM), '30 Okt 2026')
  assert.equal(formatInstant(at, DATE_NUMERIC), '30/10/2026')
  assert.equal(formatInstant(at, DATETIME_MEDIUM), '30 Okt 2026, 00.30')
  assert.equal(formatInstant(at, DATETIME_LONG), '30 Oktober 2026 pukul 00.30')
  assert.equal(formatInstant(at, DATETIME_MEDIUM, 'America/Los_Angeles'), '29 Okt 2026, 10.30')
  assert.equal(formatInstant('2026-10-29T16:59:00Z', DATE_MEDIUM), '29 Okt 2026')
  assert.throws(() => formatInstant('bukan tanggal'), RangeError)
})

t('zoneLabel: WIB untuk Jakarta, GMT±n untuk zona lain', () => {
  assert.equal(zoneLabel('Asia/Jakarta'), 'WIB')
  assert.equal(zoneLabel('Asia/Makassar'), 'WITA')
  assert.equal(zoneLabel('Asia/Jayapura'), 'WIT')
  assert.equal(zoneLabel('Asia/Riyadh'), 'GMT+3')
  assert.equal(zoneLabel('Asia/Kolkata'), 'GMT+5:30')
  assert.equal(zoneLabel('America/Los_Angeles', new Date('2026-10-30T00:00:00Z')), 'GMT-7')
  assert.equal(zoneLabel('America/Los_Angeles', new Date('2026-12-30T00:00:00Z')), 'GMT-8')
})

t('kebijakan pembatalan memakai HARI KALENDER zona aplikasi (dulu selisih instan: batal sore hari 61 hari sebelum berangkat dihitung 60 → refund 50% saja)', () => {
  const dep = dbDateOf('2026-12-30')
  const table: Array<[string, number, string]> = [
    ['2026-10-30T10:00:00Z', 100, '17.00 WIB tgl 30 Okt = 61 hari kalender (dulu 60,58 → lantai 60 → 50%)'],
    ['2026-10-30T16:59:59Z', 100, '23:59:59 WIB tgl 30 Okt = 61 hari'],
    ['2026-10-30T17:00:00Z', 50, '00:00 WIB tgl 31 Okt = 60 hari → bukan ">60"'],
    ['2026-11-29T16:59:59Z', 50, '29 Nov 23:59 WIB = 31 hari'],
    ['2026-11-29T17:00:00Z', 50, '30 Nov 00:00 WIB = 30 hari → batas bawah 50%'],
    ['2026-11-30T16:59:59Z', 50, '30 Nov 23:59 WIB = 30 hari'],
    ['2026-11-30T17:00:00Z', 0, '1 Des 00:00 WIB = 29 hari → 0%'],
    ['2026-12-29T17:00:00Z', 0, 'hari keberangkatan'],
  ]
  for (const [at, pct, why] of table) assert.equal(getCancellationPolicy(dep, new Date(at)).refundPercent, pct, `${at} — ${why}`)
})

t('zona aplikasi = setelan: setAppTimezone mengubah SEMUA bawaan (hari ini, batas hari, format, input); nama tak dikenal ditolak dan zona tak berubah; isValidTimezone', () => {
  for (const ok of ['Asia/Jakarta', 'Asia/Riyadh', 'America/Los_Angeles', 'UTC', 'Asia/Makassar']) assert.equal(isValidTimezone(ok), true, ok)
  for (const bad of ['', 'WIB', 'Jakarta', 'Asia/Nowhere', 'a'.repeat(65), 123, null, undefined]) assert.equal(isValidTimezone(bad), false, String(bad))
  const at = new Date('2026-10-29T17:30:00Z')
  try {
    assert.equal(dateInApp(at), '2026-10-30')
    setAppTimezone('Asia/Riyadh')
    assert.equal(getAppTimezone(), 'Asia/Riyadh')
    assert.equal(dateInApp(at), '2026-10-29', 'di Riyadh (+3) masih 29 Okt 20.30')
    assert.equal(formatInstant(at, DATETIME_MEDIUM), '29 Okt 2026, 20.30')
    assert.equal(iso(startOfDayInApp('2026-10-30')), '2026-10-29T21:00:00.000Z')
    assert.equal(iso(parseAppDateTime('2026-10-30T09:24')!), '2026-10-30T06:24:00.000Z')
    assert.equal(toAppDateTimeInput(at), '2026-10-29T20:30')
    assert.equal(zoneLabel(), 'GMT+3')
    assert.throws(() => setAppTimezone('Asia/Nowhere'), RangeError)
    assert.equal(getAppTimezone(), 'Asia/Riyadh', 'tetap setelah penolakan')
  } finally { setAppTimezone('Asia/Jakarta') }
  assert.equal(dateInApp(at), '2026-10-30')
})

t('SEC-110: zona aplikasi hidup di globalThis — instans modul KEDUA (Next dapat memuat lib/time ganda: instrumentation/route/halaman) melihat setelan yang diset instans pertama; isCanonicalTimezone menolak bentuk offset', async () => {
  // Instans modul TERPISAH: salinan berkas ke jalur lain (Bun mengabaikan query string pada impor, jadi `?x` tetap instans yang sama). Modul ini murni, tanpa impor lain.
  const dir = mkdtempSync(join(tmpdir(), 'time-inst-'))
  copyFileSync(new URL('../lib/time/index.ts', import.meta.url), join(dir, 'time.ts'))
  const other = await import(join(dir, 'time.ts')) as typeof import('@/lib/time')
  rmSync(dir, { recursive: true, force: true })
  assert.notEqual(other.setAppTimezone, setAppTimezone, 'prasyarat: benar-benar instans modul terpisah')
  try {
    setAppTimezone('Asia/Riyadh')
    assert.equal(other.getAppTimezone(), 'Asia/Riyadh')
    other.setAppTimezone('Asia/Makassar')
    assert.equal(getAppTimezone(), 'Asia/Makassar')
    assert.equal(other.dateInApp(new Date('2026-10-29T16:30:00Z')), '2026-10-30')
  } finally { setAppTimezone('Asia/Jakarta') }
  assert.equal(other.getAppTimezone(), 'Asia/Jakarta')
  for (const bad of ['+07:00', 'GMT+7', 'UTC+3', 'asia/jakarta', 'WIB', '', 7]) assert.equal(isCanonicalTimezone(bad), false, String(bad))
  for (const good of ['Asia/Jakarta', 'UTC', 'America/Los_Angeles']) assert.equal(isCanonicalTimezone(good), true, good)
})

await Promise.all(pending)
console.log(failed ? `\n[${tzEnv}] ${failed} GAGAL` : `\n[${tzEnv}] SEMUA LULUS`)
process.exit(failed ? 1 : 0)
