'use client'

import { useId } from 'react'
import { getAppTimezone, parseAppDateTime, toAppDateTimeInput, zoneLabel } from '@/lib/time'

/** Nilai kotak (`YYYY-MM-DDTHH:mm`, zona aplikasi) → instan ISO UTC; kosong/tak sah → `null`. */
export const inputToIso = (v: string, tz: string = getAppTimezone()): string | null => parseAppDateTime(v, tz)?.toISOString() ?? null
/** Instan ISO UTC → nilai kotak di zona aplikasi; kosong → ''. */
export const isoToInput = (iso: string | null, tz: string = getAppTimezone()): string => (iso ? toAppDateTimeInput(new Date(iso), tz) : '')

type Props = {
  /** Instan (ISO UTC, mis. "2026-10-30T02:24:00.000Z") atau `null`/'' = kosong. */
  value: string | null
  /** Instan ISO UTC yang baru, atau `null` bila isian dikosongkan/tak sah. */
  onChange: (isoUtc: string | null) => void
  label?: string
  disabled?: boolean
  required?: boolean
  className?: string
  tz?: string
}

/**
 * Input tanggal-jam yang BENAR zonanya (docs/arsitektur-booking-engine-v2.md §5): nilai yang diketik ditafsirkan di zona APLIKASI (bukan zona peramban/perangkat),
 * label zona ("WIB") selalu terlihat, dan yang dikembalikan adalah instan UTC ISO. Nilai awal "sekarang" (mis. waktu konfirmasi bayar) diisi PEMANGGIL: `useState(() => new Date().toISOString())`. Satu-satunya tempat `type="datetime-local"` (dijaga scripts/test-time-guard.ts).
 */
export function DateTimeField({ value, onChange, label, disabled, required, className, tz = getAppTimezone() }: Props) {
  const id = useId()
  const shown = isoToInput(value, tz)
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">{label}</label>}
      <div className="flex items-center gap-2">
        <input
          id={id} type="datetime-local" value={shown} disabled={disabled} required={required}
          onChange={e => onChange(inputToIso(e.target.value, tz))}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="shrink-0 text-xs font-medium text-muted-foreground" title={tz}>{zoneLabel(tz)}</span>
      </div>
    </div>
  )
}
