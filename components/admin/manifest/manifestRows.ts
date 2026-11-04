import { standardFieldOf, STANDARD_FIELDS, type ManifestFieldType, type ManifestOption, type StandardField } from '@/lib/manifest/fieldDefs'
import { isManifestRole, type ManifestRole } from '@/lib/manifest/roles'
import type { ManifestFieldInput } from '@/lib/validators/manifest'

// Nilai murni editor kolom data jamaah (docs/arsitektur-manifest.md §9) — dipakai ManifestFieldsEditor dan diuji tanpa peramban.

/** Satu baris editor. `fieldKey` null = belum tersimpan; `optionsText` = pilihan kolom bebas, satu per baris. */
export type ManifestRow = {
  uid: string; fieldKey: string | null; role: ManifestRole | null; label: string; fieldType: ManifestFieldType; required: boolean
  options: ManifestOption[] | null; optionsText: string
}

export type ManifestFieldLike = { fieldKey: string; label: string; fieldType: string; required: boolean; role: string | null; options: ManifestOption[] | null }

let seq = 0
const uid = () => `kolom-${++seq}`

export const rowFromField = (f: ManifestFieldLike): ManifestRow => ({
  uid: uid(), fieldKey: f.fieldKey, role: isManifestRole(f.role) ? f.role : null, label: f.label, fieldType: f.fieldType as ManifestFieldType, required: f.required,
  options: f.options, optionsText: (f.options ?? []).map(o => o.label).join('\n'),
})

export const rowFromStandard = (s: StandardField): ManifestRow => ({
  uid: uid(), fieldKey: null, role: s.role, label: s.label, fieldType: s.fieldType, required: s.required, options: s.options ? [...s.options] : null, optionsText: '',
})

export const newFreeRow = (): ManifestRow => ({ uid: uid(), fieldKey: null, role: null, label: '', fieldType: 'text', required: true, options: null, optionsText: '' })

export const defaultRows = (): ManifestRow[] => STANDARD_FIELDS.filter(f => f.isDefault).map(rowFromStandard)

/** Pilihan dari teks: label yang sudah ada mempertahankan nilainya (jawaban jamaah yang tersimpan tetap cocok), label baru = nilainya sendiri. */
function optionsFromText(row: ManifestRow): ManifestOption[] {
  const known = new Map((row.options ?? []).map(o => [o.label, o.value]))
  return row.optionsText.split('\n').map(l => l.trim()).filter(Boolean).map(label => ({ label, value: known.get(label) ?? label }))
}

/** Badan API. Kolom standar memakai pilihan tetapnya; hanya kolom bebas bertipe Pilihan yang mengambil dari teks. */
export const bodyFromManifestRows = (rows: readonly ManifestRow[]): ManifestFieldInput[] => rows.map(r => {
  const std = standardFieldOf(r.role)
  const options = r.fieldType !== 'select' ? null : std ? (r.options ?? (std.options ? [...std.options] : null)) : optionsFromText(r)
  return { fieldKey: r.fieldKey, label: r.label.trim(), fieldType: r.fieldType, required: r.required, role: r.role, options }
})

/** Kolom standar yang belum dipakai, untuk tombol tambah. */
export const addableStandard = (rows: readonly ManifestRow[]): StandardField[] => STANDARD_FIELDS.filter(s => !rows.some(r => r.role === s.role))
