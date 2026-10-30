// Murni — pilihan periode laporan (zona aplikasi, lib/time) untuk filter "Periode" (docs/arsitektur-tabel.md §2.3). Dulu disalin di dua halaman laporan.
import { addDays, todayInApp } from '@/lib/time'
export type PeriodPreset = { key: string; label: string; from: string; to: string }

/** Bulan ini, Bulan lalu, 90 hari, Tahun ini — dihitung dari `now` di zona aplikasi. */
export function periodPresets(now: Date = new Date()): PeriodPreset[] {
  const today = todayInApp(now)
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
