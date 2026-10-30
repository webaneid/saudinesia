'use client'

import { getAppTimezone, isValidTimezone, setAppTimezone } from '@/lib/time'

/**
 * Menyamakan zona aplikasi di KLIEN dengan setelan server (docs/arsitektur-booking-engine-v2.md §6): diset saat render (sebelum anak merender tanggal), bukan di effect,
 * supaya hidrasi memakai zona yang sama dengan HTML dari server. Tidak merender apa pun.
 */
export function AppTimezoneProvider({ tz }: { tz: string }) {
  if (isValidTimezone(tz) && getAppTimezone() !== tz) setAppTimezone(tz)
  return null
}
