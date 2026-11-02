import { z } from 'zod'
import { addressSchema } from '@/lib/validators/address'

// Nilai field manifest `fieldType='address'` (docs/arsitektur-jamaah.md §5.5 butir 3, D1): objek alamat BEKU di snapshot jamaah booking — kode wilayah
// + baris jalan + `text` (satu baris terformat). `text` SELALU dihitung server dari nama wilayah di DB (lib/manifest/address.ts), tak pernah dari klien.
// Murni — aman di klien (formulir) dan server.

export type ManifestAddressValue = {
  type: 'domestic' | 'international'
  fullAddress: string
  postalCode: string | null
  provinceId: string | null
  regencyId: string | null
  districtId: string | null
  villageId: string | null
  countryCode: string | null
  city: string | null
  stateRegion: string | null
  /** Satu baris terformat (jalan, desa, kecamatan, kab/kota, provinsi, kode pos) — diisi server. */
  text?: string
}

/** Bentuk masukan dari formulir: alamat (aturan `addressSchema`) + `text` lama yang DIBUANG (diturunkan ulang di server). */
export const manifestAddressInputSchema = addressSchema

/** Kosong = belum ada baris jalan (nilai bawaan `AddressPicker`). */
export const isEmptyAddress = (v: unknown): boolean =>
  !!v && typeof v === 'object' && 'fullAddress' in v && !(v as { fullAddress?: unknown }).fullAddress

/** Objek snapshot → nilai `AddressPicker` (string kosong untuk yang belum diisi). */
export function toPickerAddress(v: unknown) {
  const a = (v && typeof v === 'object' ? v : {}) as Partial<ManifestAddressValue>
  return {
    type: a.type === 'international' ? 'international' as const : 'domestic' as const,
    fullAddress: a.fullAddress ?? '', postalCode: a.postalCode ?? '',
    provinceId: a.provinceId ?? null, regencyId: a.regencyId ?? null, districtId: a.districtId ?? null, villageId: a.villageId ?? null,
    countryCode: a.countryCode ?? null, city: a.city ?? '', stateRegion: a.stateRegion ?? '',
  }
}

export type ManifestAddressInput = z.infer<typeof manifestAddressInputSchema>
