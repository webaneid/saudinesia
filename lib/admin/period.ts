// Murni — pilihan periode laporan (WIB) untuk filter "Periode" (docs/arsitektur-tabel.md §2.3). Dulu disalin di dua halaman laporan.
export type PeriodPreset = { key: string; label: string; from: string; to: string }

const WIB_MS = 7 * 3_600_000
/** Tanggal kalender WIB (YYYY-MM-DD) dari satu instan. */
export const wibDate = (d: Date): string => new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10)
export const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Bulan ini, Bulan lalu, 90 hari, Tahun ini — dihitung dari `now` (WIB). */
export function periodPresets(now: Date = new Date()): PeriodPreset[] {
  const today = wibDate(now)
  const month = today.slice(0, 8) // "YYYY-MM-"
  const lastMonthEnd = addDays(`${month}01`, -1)
  return [
    { key: 'month', label: 'Bulan ini', from: `${month}01`, to: today },
    { key: 'prev', label: 'Bulan lalu', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { key: '90', label: '90 hari terakhir', from: addDays(today, -89), to: today },
    { key: 'year', label: 'Tahun ini', from: `${today.slice(0, 5)}01-01`, to: today },
  ]
}

/** Kunci preset yang cocok persis dengan rentang; '' = rentang kustom. */
export function matchPreset(presets: readonly PeriodPreset[], from: string, to: string): string {
  return presets.find(p => p.from === from && p.to === to)?.key ?? ''
}
