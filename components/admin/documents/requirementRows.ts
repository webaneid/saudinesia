import type { RequirementView } from '@/lib/documents/completeness'
import type { DocumentRequirementInput } from '@/lib/validators/documents'

// Nilai murni editor syarat dokumen produk (docs/arsitektur-jamaah.md §7.6) — dipakai RequirementsEditor dan diuji tanpa peramban.

/** Satu baris editor. `label` kosong = label katalog; `typeLabel` hanya untuk tampilan. */
export type RequirementRow = { documentTypeId: string; typeLabel: string; label: string; description: string; required: boolean }

export const rowFromView = (r: RequirementView): RequirementRow =>
  ({ documentTypeId: r.documentTypeId, typeLabel: r.typeLabel, label: r.label === r.typeLabel ? '' : r.label, description: r.description, required: r.required })

/** Badan API: baris tanpa jenis dibuang, label sama dengan katalog dikosongkan (ikut katalog bila katalog berganti nama). */
export const bodyFromRows = (rows: readonly RequirementRow[]): DocumentRequirementInput[] =>
  rows.filter(r => r.documentTypeId).map(r => {
    const label = r.label.trim()
    return { documentTypeId: r.documentTypeId, label: label && label !== r.typeLabel ? label : null, description: r.description.trim(), required: r.required }
  })

export const moveRow = <T>(rows: readonly T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir
  const a = rows[i]
  const b = rows[j]
  if (a === undefined || b === undefined) return [...rows]
  const next = [...rows]
  next[i] = b
  next[j] = a
  return next
}
