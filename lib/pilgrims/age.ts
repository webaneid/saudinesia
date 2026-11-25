import { todayInApp, type CalendarDate } from '@/lib/time'

/** Umur < 2 tahun pada hari ini (zona aplikasi) — satu-satunya pengecualian NIK wajib bagi WNI (K2). Murni. */
export function isBaby(birthDate: CalendarDate, today: CalendarDate = todayInApp()): boolean {
  const [y, m, d] = today.split('-')
  const back = `${Number(y) - 2}-${m}-${d}`
  const cutoff = m === '02' && d === '29' ? `${Number(y) - 2}-03-01` : back // 29 Feb tak ada 2 tahun lalu
  return birthDate > cutoff
}
