import { fieldKeyFromLabel } from '@/lib/manifest/fieldDefs'
import { PILGRIM_FIELD_KEY_RE } from '@/lib/validators/pilgrimFields'

// Nilai formulir kolom Data Jamaah (tambah & ubah) — murni, tanpa React. Pilihan diketik satu per baris (nilai = teks pilihan);
// `key` hanya dikirim saat membuat. Server (`lib/validators/pilgrimFields.ts` + `lib/pilgrim-data/fields.ts`) tetap yang menilai.

export type PilgrimFieldOption = { label: string; value: string }

export type PilgrimFieldRow = {
  id: string; key: string; label: string; fieldType: string; options: PilgrimFieldOption[] | null; role: string | null
  required: boolean; isSystem: boolean; isActive: boolean; order: number
  usage?: { bookingPilgrims: number; cards: number }
}

export type PilgrimFieldForm = { key: string; label: string; fieldType: string; optionsText: string; required: boolean; order: string; isActive: boolean }

export const EMPTY_FIELD_FORM: PilgrimFieldForm = { key: '', label: '', fieldType: 'text', optionsText: '', required: false, order: '100', isActive: true }

/** Kunci usulan dari label: "Golongan Darah" → "golonganDarah". */
export const keyFromFieldLabel = (label: string) => { const k = fieldKeyFromLabel(label); return k === 'kolom' && !label.trim() ? '' : k }

export const formFromField = (f: PilgrimFieldRow): PilgrimFieldForm => ({
  key: f.key, label: f.label, fieldType: f.fieldType, optionsText: (f.options ?? []).map(o => o.label).join('\n'),
  required: f.required, order: String(f.order), isActive: f.isActive,
})

export const optionsFromText = (text: string): PilgrimFieldOption[] =>
  text.split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ label: s.slice(0, 80), value: s.slice(0, 80) }))

/** Badan permintaan. Kolom bawaan tidak mengirim tipe/pilihan (server menolaknya). */
export function bodyFromFieldForm(f: PilgrimFieldForm, mode: 'create' | 'update', isSystem = false): Record<string, unknown> {
  const body: Record<string, unknown> = { label: f.label.trim(), required: f.required, order: Number(f.order) || 0, isActive: f.isActive }
  if (mode === 'create') body.key = f.key.trim()
  if (!isSystem) Object.assign(body, { fieldType: f.fieldType, options: f.fieldType === 'select' ? optionsFromText(f.optionsText) : null })
  return body
}

export const canSubmitField = (f: PilgrimFieldForm, mode: 'create' | 'update', isSystem = false) =>
  f.label.trim().length >= 2
  && (mode === 'update' || PILGRIM_FIELD_KEY_RE.test(f.key.trim()))
  && (isSystem || f.fieldType !== 'select' || optionsFromText(f.optionsText).length >= 2)
