import { MANIFEST_ROLES, isManifestRole, type ManifestRole } from '@/lib/manifest/roles'
import type { ManifestField } from '@/components/booking/ManifestFieldsForm'

// Aturan tampil formulir kartu jamaah atas katalog Data Jamaah (docs/rencana-profil-jamaah.md P2) — murni, dipakai `SavedPilgrimFields`, popup, dan Profil.

export type CardField = ManifestField

/** Selalu tampil walau nonaktif di katalog: sistem tak bisa menyimpan kartu tanpanya. */
export const ALWAYS_SHOWN: readonly ManifestRole[] = ['display_name', 'birth_date']

export type CardLayout = {
  /** Kolom bawaan yang tampil → definisinya (null = katalog tak tersedia / kolom selalu-tampil yang nonaktif: label bawaan). */
  roles: Map<ManifestRole, CardField | null>
  /** Kolom buatan admin. */
  extras: CardField[]
}

/** `fields` null = katalog gagal dimuat → semua kolom bawaan. `omit` = kolom yang sudah ada di formulir induk (mis. Profil). */
export function cardLayout(fields: readonly CardField[] | null, omit: readonly ManifestRole[] = []): CardLayout {
  const roles = new Map<ManifestRole, CardField | null>()
  if (!fields) for (const r of MANIFEST_ROLES) roles.set(r, null)
  else {
    for (const f of [...fields].sort((a, b) => a.order - b.order)) if (isManifestRole(f.role)) roles.set(f.role, f)
    for (const r of ALWAYS_SHOWN) if (!roles.has(r)) roles.set(r, null)
  }
  for (const r of omit) roles.delete(r)
  return { roles, extras: (fields ?? []).filter(f => f.role === null) }
}

/** Peran `wanted` yang tampil, dalam urutan katalog. */
export const orderedRoles = (layout: CardLayout, wanted: readonly ManifestRole[]): ManifestRole[] => [...layout.roles.keys()].filter(r => wanted.includes(r))

/** Katalog dengan kolom alamat wajib (ditambahkan bila nonaktif). */
export function withRequiredAddress(fields: readonly CardField[], label: string): CardField[] {
  if (fields.some(f => f.role === 'address')) return fields.map(f => (f.role === 'address' ? { ...f, required: true } : f))
  return [...fields, { id: 'address', fieldKey: 'address', label, fieldType: 'address', options: null, required: true, role: 'address', order: Number.MAX_SAFE_INTEGER }]
}
