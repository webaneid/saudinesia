// Tipe kolom data jamaah (docs/arsitektur-data-jamaah.md §3.1) — murni, aman di klien. Daftar tipe = CHECK `pilgrim_fields_type_chk`
// (dijaga scripts/test-pilgrim-data.ts). Kolom bawaan per peran ada di katalog `pilgrim_fields` (isi awal dari migrasi), bukan di kode.

export const MANIFEST_FIELD_TYPES = ['text', 'textarea', 'phone', 'email', 'date', 'select', 'number', 'address'] as const
export type ManifestFieldType = (typeof MANIFEST_FIELD_TYPES)[number]

export const FIELD_TYPE_LABEL: Record<ManifestFieldType, string> = {
  text: 'Teks singkat', textarea: 'Teks panjang', phone: 'Nomor telepon', email: 'Email', date: 'Tanggal', select: 'Pilihan', number: 'Angka', address: 'Alamat berjenjang',
}

/** Label kolom buatan admin yang meminta data rahasia: nilainya akan tersimpan polos, jadi harus lewat kolom bawaan yang disegel. */
export const looksLikeSealedData = (label: string): boolean => /\b(nik|ktp|paspor|passport)\b|nomor induk/i.test(label)

/** Kunci mesin dari label: camelCase huruf/angka latin; label tanpa huruf latin → `kolom`. */
export function fieldKeyFromLabel(label: string): string {
  const words = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const key = words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('').slice(0, 30)
  return /^[a-z]/.test(key) ? key : 'kolom'
}
