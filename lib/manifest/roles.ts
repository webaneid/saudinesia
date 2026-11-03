import { getCountryName } from '@/lib/constants/countries'
import { splitE164 } from '@/lib/utils/phone'
import { maskPassport, NIK_MASK } from '@/lib/pii/mask'
import type { CalendarDate } from '@/lib/time'

// Peran field manifest = PENGIKAT ke atribut kartu jamaah (docs/arsitektur-jamaah.md §5.3 butir 2). Daftar TUNGGAL — CHECK DB di migrasi
// `20261115090000_booking_pilgrim_cards` memakai daftar yang sama (dijaga scripts/test-booking-link.ts). Satu peran paling banyak satu field per produk.
// Murni (tanpa DB/kunci PII) — aman di klien; NIK/paspor di snapshot hanya samaran, nilai utuh disegel di kolom `booking_pilgrims.*Cipher`.

export const MANIFEST_ROLES = [
  'display_name', 'gender', 'birth_place', 'birth_date', 'nationality', 'passport_expiry', 'passport_issued',
  'phone', 'whatsapp', 'email', 'address', 'nik', 'passport_number',
] as const
export type ManifestRole = (typeof MANIFEST_ROLES)[number]

/** Peran yang nilainya rahasia: snapshot hanya samaran, nilai utuh disegel (lib/pii). */
export const SEALED_ROLES = ['nik', 'passport_number'] as const satisfies readonly ManifestRole[]
export const isSealedRole = (role: string | null | undefined): role is (typeof SEALED_ROLES)[number] => role === 'nik' || role === 'passport_number'

export const isManifestRole = (role: string | null | undefined): role is ManifestRole => !!role && (MANIFEST_ROLES as readonly string[]).includes(role)

/** Atribut kartu yang dibutuhkan pengisian snapshot — bentuk tampilan pemilik (NIK tersamar, paspor 4 karakter terakhir). */
export type CardForSnapshot = {
  fullName: string
  gender: 'male' | 'female' | null
  birthPlace: string | null
  birthDate: CalendarDate | null
  nationality: string
  hasNik: boolean
  passportLast4: string | null
  passportIssuedAt: CalendarDate | null
  passportExpiry: CalendarDate | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  /** Alamat sebagai teks (field alamat berjenjang menyusul di 7b). */
  addressText: string | null
}

type Field = { fieldKey: string; fieldType: string; role: string | null }

const phoneValue = (digits: string | null) => {
  if (!digits) return null
  const { countryCode, local } = splitE164(digits)
  return { countryCode, number: local }
}

/** Nilai satu peran dari kartu, dalam bentuk `fieldType` field-nya; `undefined` = peran/bentuk tak bisa diisi dari kartu (field dibiarkan). */
function valueFor(role: ManifestRole, fieldType: string, c: CardForSnapshot): unknown {
  switch (role) {
    case 'display_name': return c.fullName
    case 'gender': return c.gender
    case 'birth_place': return c.birthPlace
    case 'birth_date': return fieldType === 'date' ? c.birthDate : undefined
    case 'nationality': return fieldType === 'select' ? c.nationality : (getCountryName(c.nationality) ?? c.nationality)
    case 'passport_expiry': return fieldType === 'date' ? c.passportExpiry : undefined
    case 'passport_issued': return fieldType === 'date' ? c.passportIssuedAt : undefined
    case 'phone': return fieldType === 'phone' ? phoneValue(c.phone) : undefined
    case 'whatsapp': return fieldType === 'phone' ? phoneValue(c.whatsapp) : undefined
    case 'email': return c.email
    case 'address': return fieldType === 'text' || fieldType === 'textarea' ? c.addressText : undefined
    case 'nik': return c.hasNik ? NIK_MASK : null
    case 'passport_number': return c.passportLast4 ? maskPassport(c.passportLast4) : null
  }
}

/**
 * Isian snapshot dari kartu: HANYA field berperan; field tanpa peran (data khusus produk) tidak disentuh. Kartu kosong pada suatu atribut
 * MENGOSONGKAN field berperan itu (snapshot = keadaan kartu saat ditautkan/diperbarui).
 */
export function snapshotFromCard(fields: readonly Field[], card: CardForSnapshot): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (!isManifestRole(f.role)) continue
    const v = valueFor(f.role, f.fieldType, card)
    if (v !== undefined) out[f.fieldKey] = v ?? null
  }
  return out
}

/** Kunci field yang diisi dari kartu (untuk menandai di formulir). */
export function cardBoundKeys(fields: readonly Field[]): string[] {
  return fields.filter(f => isManifestRole(f.role)).map(f => f.fieldKey)
}
