// Nilai formulir jenis dokumen (tambah & ubah) — murni, tanpa React. Angka/teks kosong → null; `key` hanya dikirim saat membuat.

export type DocumentTypeForm = {
  key: string; label: string; icon: string; reusable: boolean; hasExpiry: boolean; minValidityMonths: string
  referenceLabel: string; referencePattern: string; allowMultiple: boolean; order: string; isActive: boolean
}

export type DocumentTypeRow = {
  id: string; key: string; label: string; icon: string; reusable: boolean; hasExpiry: boolean; minValidityMonths: number | null
  referenceLabel: string | null; referencePattern: string | null; allowMultiple: boolean; isSystem: boolean; isActive: boolean; order: number
  _count?: { documents: number }
}

export const EMPTY_TYPE_FORM: DocumentTypeForm = {
  key: '', label: '', icon: 'FileText', reusable: true, hasExpiry: false, minValidityMonths: '', referenceLabel: '', referencePattern: '', allowMultiple: false, order: '100', isActive: true,
}

export const formFromType = (t: DocumentTypeRow): DocumentTypeForm => ({
  key: t.key, label: t.label, icon: t.icon, reusable: t.reusable, hasExpiry: t.hasExpiry, minValidityMonths: t.minValidityMonths?.toString() ?? '',
  referenceLabel: t.referenceLabel ?? '', referencePattern: t.referencePattern ?? '', allowMultiple: t.allowMultiple, order: String(t.order), isActive: t.isActive,
})

const intOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

/** Badan permintaan. Jenis bawaan tidak mengirim sifat yang terkunci (server menolaknya). */
export function bodyFromTypeForm(f: DocumentTypeForm, mode: 'create' | 'update', isSystem = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    label: f.label.trim(), icon: f.icon,
    minValidityMonths: f.hasExpiry ? intOrNull(f.minValidityMonths) : null,
    referenceLabel: f.referenceLabel.trim() || null,
    referencePattern: f.referenceLabel.trim() ? (f.referencePattern.trim() || null) : null,
    order: Number(f.order) || 0, isActive: f.isActive,
  }
  if (mode === 'create') body.key = f.key.trim()
  if (!isSystem) Object.assign(body, { reusable: f.reusable, hasExpiry: f.hasExpiry, allowMultiple: f.allowMultiple })
  return body
}

export const canSubmitType = (f: DocumentTypeForm, mode: 'create' | 'update') =>
  f.label.trim().length >= 2 && (mode === 'update' || /^[a-z][a-z0-9_]{1,39}$/.test(f.key.trim()))
