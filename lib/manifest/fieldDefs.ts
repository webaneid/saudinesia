import type { ManifestRole } from './roles'

// Definisi kolom data jamaah (docs/arsitektur-manifest.md §9) — murni, aman di klien. Satu daftar kolom standar per peran: bentuknya tetap karena
// pengikat kartu (`snapshotFromCard`, lib/manifest/roles.ts) dan penyegelan NIK/paspor bergantung pada tipe. Kolom bebas (tanpa peran) = data khusus produk.

export const MANIFEST_FIELD_TYPES = ['text', 'textarea', 'phone', 'email', 'date', 'select', 'number', 'address'] as const
export type ManifestFieldType = (typeof MANIFEST_FIELD_TYPES)[number]

export const FIELD_TYPE_LABEL: Record<ManifestFieldType, string> = {
  text: 'Teks singkat', textarea: 'Teks panjang', phone: 'Nomor telepon', email: 'Email', date: 'Tanggal', select: 'Pilihan', number: 'Angka', address: 'Alamat berjenjang',
}

export type ManifestOption = { label: string; value: string }

export type StandardField = {
  role: ManifestRole; fieldKey: string; label: string; fieldType: ManifestFieldType; required: boolean
  /** Ikut daftar bawaan produk baru. */
  isDefault: boolean
  options?: readonly ManifestOption[]
}

const GENDER_OPTIONS: readonly ManifestOption[] = [{ label: 'Laki-laki', value: 'male' }, { label: 'Perempuan', value: 'female' }]

export const STANDARD_FIELDS: readonly StandardField[] = [
  { role: 'display_name', fieldKey: 'fullName', label: 'Nama Lengkap', fieldType: 'text', required: true, isDefault: true },
  { role: 'gender', fieldKey: 'gender', label: 'Jenis Kelamin', fieldType: 'select', required: true, isDefault: true, options: GENDER_OPTIONS },
  { role: 'email', fieldKey: 'email', label: 'Email', fieldType: 'email', required: false, isDefault: true },
  { role: 'phone', fieldKey: 'phone', label: 'Nomor HP', fieldType: 'phone', required: false, isDefault: true },
  { role: 'whatsapp', fieldKey: 'whatsapp', label: 'Nomor WhatsApp', fieldType: 'phone', required: false, isDefault: true },
  { role: 'passport_number', fieldKey: 'passportNumber', label: 'Nomor Paspor', fieldType: 'text', required: false, isDefault: true },
  { role: 'passport_expiry', fieldKey: 'passportExpiry', label: 'Tanggal Kadaluarsa Paspor', fieldType: 'date', required: false, isDefault: true },
  { role: 'nationality', fieldKey: 'nationality', label: 'Kewarganegaraan', fieldType: 'text', required: false, isDefault: true },
  { role: 'birth_date', fieldKey: 'dateOfBirth', label: 'Tanggal Lahir', fieldType: 'date', required: false, isDefault: true },
  { role: 'nik', fieldKey: 'nik', label: 'NIK', fieldType: 'text', required: false, isDefault: false },
  { role: 'birth_place', fieldKey: 'birthPlace', label: 'Tempat Lahir', fieldType: 'text', required: false, isDefault: false },
  { role: 'passport_issued', fieldKey: 'passportIssuedAt', label: 'Tanggal Terbit Paspor', fieldType: 'date', required: false, isDefault: false },
  { role: 'address', fieldKey: 'address', label: 'Alamat', fieldType: 'address', required: false, isDefault: false },
]

export const standardFieldOf = (role: string | null | undefined): StandardField | undefined => STANDARD_FIELDS.find(f => f.role === role)

/** Tipe yang sah per peran. `address` boleh teks untuk data lama (`valueFor` mengisinya dengan satu baris alamat). */
export function allowedTypesForRole(role: ManifestRole): readonly ManifestFieldType[] {
  if (role === 'address') return ['address', 'text', 'textarea']
  const std = standardFieldOf(role)
  return std ? [std.fieldType] : []
}

/** Label kolom bebas yang meminta data rahasia: nilainya akan tersimpan polos di `fieldValues`, jadi harus lewat kolom standar yang disegel. */
export const looksLikeSealedData = (label: string): boolean => /\b(nik|ktp|paspor|passport)\b|nomor induk/i.test(label)

/** Kunci mesin dari label: camelCase huruf/angka latin; label tanpa huruf latin → `kolom`. */
export function fieldKeyFromLabel(label: string): string {
  const words = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const key = words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('').slice(0, 30)
  return /^[a-z]/.test(key) ? key : 'kolom'
}

/** Kunci tak boleh menabrak kunci lain atau properti bawaan objek (`constructor`, dst.) karena dipakai sebagai kunci `fieldValues`. */
export function uniqueFieldKey(base: string, taken: ReadonlySet<string>): string {
  const free = (k: string) => !taken.has(k) && !(k in Object.prototype)
  if (free(base)) return base
  for (let n = 2; ; n++) if (free(`${base}${n}`)) return `${base}${n}`
}
