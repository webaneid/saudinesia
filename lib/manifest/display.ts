// Data jamaah booking sebagai TEKS siap baca untuk petugas yang memeriksa (docs/arsitektur-jamaah.md §8.4) — label kolom + nilai tampil,
// kolom wajib yang kosong ditandai dengan aturan yang SAMA dengan penolakan "Ajukan" (`isEmptyValue`). Murni, aman di server dan klien.
// Hanya menampilkan nilai yang sudah ada di `fieldValues` (NIK/paspor di sana sudah samaran — lib/pilgrims/bookingLink.ts).
import { COUNTRIES } from '@/lib/constants/countries'
import { DATE_LONG, formatCalendarDate, isCalendarDate } from '@/lib/time'
import { isEmptyValue } from './values'

type Field = { fieldKey: string; label: string; fieldType: string; options: unknown; required: boolean }
export type FieldRow = { key: string; label: string; value: string | null; required: boolean; missing: boolean }

const DIAL = new Map<string, string>(COUNTRIES.map(c => [c.code, c.dialCode]))

function optionLabel(options: unknown, value: string): string {
  if (!Array.isArray(options)) return value
  const hit = options.find((o): o is { value: string; label: string } => !!o && typeof o === 'object' && (o as { value?: unknown }).value === value)
  return hit?.label ?? value
}

/** Satu nilai sebagai teks (null = kosong). */
export function formatFieldValue(field: Pick<Field, 'fieldType' | 'options'>, value: unknown, locale?: string): string | null {
  if (isEmptyValue(value)) return null
  if (typeof value === 'object' && value !== null) {
    if ('number' in value) {
      const v = value as { countryCode?: unknown; number?: unknown }
      const dial = typeof v.countryCode === 'string' ? DIAL.get(v.countryCode) : undefined
      return `${dial ? `+${dial} ` : ''}${String(v.number ?? '')}`.trim()
    }
    if ('text' in value && typeof (value as { text?: unknown }).text === 'string') return (value as { text: string }).text
    return null
  }
  const s = String(value)
  if (field.fieldType === 'date' && isCalendarDate(s)) return formatCalendarDate(s, DATE_LONG, locale)
  if (field.fieldType === 'select') return optionLabel(field.options, s)
  return s
}

/** Semua kolom (urutan pemanggil) dengan nilai tampil dan penanda wajib-kosong. `locale` = bahasa halaman untuk tanggal (bawaan Indonesia). */
export function fieldRows(fields: readonly Field[], values: Record<string, unknown>, locale?: string): FieldRow[] {
  return fields.map(f => {
    const value = formatFieldValue(f, values[f.fieldKey], locale)
    return { key: f.fieldKey, label: f.label, value, required: f.required, missing: f.required && isEmptyValue(values[f.fieldKey]) }
  })
}
