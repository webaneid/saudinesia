import { z } from 'zod'

// Nilai field manifest jamaah (docs/arsitektur-manifest.md, docs/arsitektur-booking-engine-v2.md §10.3): validasi BENTUK per `fieldType` dan kelengkapan field wajib —
// satu tempat, dipakai route admin pengisian data jamaah dan indikator kelengkapan. Field kosong SAH saat disimpan (data boleh dilanjutkan, D3); wajib → kelengkapan.

export type FieldDef = { fieldKey: string; label: string; fieldType: string; required: boolean; options: unknown }
export type PhoneValue = { countryCode: string; number: string }

const optionValues = (options: unknown): string[] =>
  Array.isArray(options) ? options.flatMap(o => (o && typeof o === 'object' && 'value' in o && typeof o.value === 'string' ? [o.value] : [])) : []

/** Kosong = tak diisi: undefined/null/'' atau telepon tanpa nomor (aturan yang sama dengan validasi checkout jamaah). */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (typeof value === 'object' && 'number' in value) return !(value as { number?: unknown }).number
  return false
}

const phoneSchema = z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/), number: z.string().regex(/^[0-9 ]{0,20}$/, 'Nomor hanya angka') }).strict()

function schemaFor(f: FieldDef): z.ZodTypeAny {
  switch (f.fieldType) {
    case 'email': return z.string().trim().max(254).email(`${f.label}: email tidak valid`)
    case 'date': return z.string().date(`${f.label}: tanggal tidak valid`)
    case 'number': return z.string().trim().regex(/^-?\d+(\.\d+)?$/, `${f.label}: harus angka`).max(30)
    case 'phone': return phoneSchema
    case 'select': return z.string().refine(v => optionValues(f.options).includes(v), `${f.label}: pilihan tidak dikenal`)
    case 'textarea': return z.string().max(2000)
    default: return z.string().max(500) // text, address (teks bebas)
  }
}

/**
 * Validasi nilai terhadap definisi field produk. Kunci yang tak didefinisikan DITOLAK (bukan dibuang diam-diam); nilai kosong disimpan sebagai `null`.
 * Kembalikan nilai bersih atau galat per field.
 */
export function validateFieldValues(fields: readonly FieldDef[], values: Record<string, unknown>): { ok: true; values: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const byKey = new Map(fields.map(f => [f.fieldKey, f]))
  const errors: Record<string, string> = {}
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(values)) {
    const f = byKey.get(key)
    if (!f) { errors[key] = 'Field tidak dikenal untuk jamaah ini'; continue }
    if (isEmptyValue(raw)) { out[key] = null; continue }
    const parsed = schemaFor(f).safeParse(typeof raw === 'string' && f.fieldType !== 'phone' ? raw.trim() : raw)
    if (parsed.success) out[key] = parsed.data
    else errors[key] = parsed.error.issues[0]?.message ?? `${f.label} tidak valid`
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: out }
}

export type Completeness = { required: number; filled: number; missing: string[]; complete: boolean }

/** Kelengkapan data jamaah: field wajib yang sudah terisi. */
export function completeness(fields: readonly FieldDef[], values: Record<string, unknown>): Completeness {
  const req = fields.filter(f => f.required)
  const missing = req.filter(f => isEmptyValue(values[f.fieldKey])).map(f => f.label)
  return { required: req.length, filled: req.length - missing.length, missing, complete: missing.length === 0 }
}
