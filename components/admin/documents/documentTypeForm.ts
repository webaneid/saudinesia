// Nilai formulir jenis dokumen (tambah & ubah) — murni, tanpa React. Angka/teks kosong → null; `key` hanya dikirim saat membuat.
// Dipakai halaman Produk → Jenis Dokumen DAN tab "Berkas custom" di popup syarat (RequirementsTable) lewat DocumentTypeFields.

/** Bentuk kunci = `documentTypeCreateSchema.key` (server tetap yang menilai). */
export const TYPE_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/

/** Kunci usulan dari label: "Surat Mahram" → "surat_mahram". */
export const keyFromLabel = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, 40)

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
  f.label.trim().length >= 2 && (mode === 'update' || TYPE_KEY_RE.test(f.key.trim()))
