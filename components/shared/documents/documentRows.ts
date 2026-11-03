import type { DocumentTypeOption, PilgrimDocumentView } from '@/lib/documents/service'

// Logika murni DocumentRepeater (diuji scripts/test-pilgrim-documents.ts): susunan baris dan isi formulir unggah. Tanpa React.

export type DocumentRow =
  | { kind: 'single'; type: DocumentTypeOption; document: PilgrimDocumentView | null }
  | { kind: 'extra'; type: DocumentTypeOption; document: PilgrimDocumentView }

/** Jenis tunggal: satu baris per jenis (terisi/kosong). Jenis boleh-banyak: satu baris per berkas; tambahannya lewat "Tambah dokumen lain". */
export function documentRows(types: DocumentTypeOption[], documents: PilgrimDocumentView[]): DocumentRow[] {
  const rows: DocumentRow[] = []
  for (const type of types) {
    const mine = documents.filter(d => d.documentTypeId === type.id)
    if (type.allowMultiple) for (const document of mine) rows.push({ kind: 'extra', type, document })
    else rows.push({ kind: 'single', type, document: mine[0] ?? null })
  }
  // Berkas jenis yang sudah dinonaktifkan tetap tampil (masih tersimpan & bisa dihapus), di akhir.
  const known = new Set(types.map(t => t.id))
  for (const document of documents.filter(d => !known.has(d.documentTypeId))) {
    rows.push({ kind: 'extra', type: { id: document.documentTypeId, key: document.typeKey, label: document.label, icon: 'FileText', hasExpiry: false, minValidityMonths: null, referenceLabel: null, referencePattern: null, allowMultiple: true }, document })
  }
  return rows
}

export type UploadDraft = { label: string; referenceCode: string; issuedAt: string; expiresAt: string }
export const EMPTY_DRAFT: UploadDraft = { label: '', referenceCode: '', issuedAt: '', expiresAt: '' }

/** Kolom yang dikirim hanya yang dipakai jenisnya (server menolak kolom yang tak relevan). */
export function uploadFields(type: DocumentTypeOption, d: UploadDraft): Record<string, string> {
  const f: Record<string, string> = { documentTypeId: type.id }
  if (type.key === 'other' && d.label.trim()) f.label = d.label.trim()
  if (type.referenceLabel && d.referenceCode.trim()) f.referenceCode = d.referenceCode.trim()
  if (type.hasExpiry) {
    if (d.issuedAt) f.issuedAt = d.issuedAt
    if (d.expiresAt) f.expiresAt = d.expiresAt
  }
  return f
}

export function canUpload(type: DocumentTypeOption, d: UploadDraft, file: File | null): boolean {
  if (!file) return false
  if (type.key === 'other' && d.label.trim().length < 2) return false
  if (type.referencePattern && !d.referenceCode.trim()) return false
  if (type.minValidityMonths != null && !d.expiresAt) return false
  return true
}

export const STATUS_TEXT: Record<PilgrimDocumentView['status'], string> = { pending: 'Menunggu pemeriksaan', accepted: 'Diterima', rejected: 'Ditolak' }
export const REJECT_TEXT: Record<NonNullable<PilgrimDocumentView['rejectReason']>, string> = {
  not_matching: 'tidak sesuai', expired: 'sudah kedaluwarsa', unreadable: 'tidak terbaca', other: 'lainnya',
}

export function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`
}
