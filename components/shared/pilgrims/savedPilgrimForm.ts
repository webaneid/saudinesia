import { EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { EMPTY_CONTACT, contactFromStored, type ContactValue } from '@/components/shared/ContactPicker'
import { e164FromCountry } from '@/lib/utils/phone'
import type { SavedPilgrimView } from '@/lib/pilgrims/service'
import type { SavedPilgrimInput } from '@/lib/validators/pilgrims'
import type { ManifestRole } from '@/lib/manifest/roles'
import { isEmptyValue } from '@/lib/manifest/values'
import { isBaby } from '@/lib/pilgrims/age'
import { isCalendarDate } from '@/lib/time'
import type { CardField } from './cardFields'

// Nilai formulir kartu jamaah (docs/arsitektur-jamaah.md §5.1) — murni, dipakai halaman jamaah dan admin.
// NIK dan nomor paspor tak pernah dikirim balik dari server: kolom kosong pada kartu yang sudah punya nilai = "tetap" (kolom tak dikirim).

export type SavedPilgrimFormValue = {
  fullName: string
  gender: '' | 'male' | 'female'
  birthPlace: string
  birthDate: string
  nationality: string
  /** Kewarganegaraan tersimpan — menggantinya mewajibkan nomor paspor diketik ulang (kolom paspor ditampilkan walau nonaktif). */
  savedNationality: string
  nik: string
  /** Kartu sudah menyimpan NIK (tersamar) — kosong = tetap. */
  hasNik: boolean
  clearNik: boolean
  passportNumber: string
  /** Samaran paspor tersimpan, mis. "•••• 4321"; kosong = belum ada. */
  passportMask: string
  passportIssuedAt: string
  passportExpiry: string
  clearPassport: boolean
  address: AddressValue
  hadAddress: boolean
  contact: ContactValue
  email: string
  isSelf: boolean
  /** Nilai kolom buatan admin (katalog Data Jamaah) — dikirim utuh; nilai kosong = dihapus di server. */
  extra: Record<string, unknown>
}

export const EMPTY_PILGRIM_FORM: SavedPilgrimFormValue = {
  fullName: '', gender: '', birthPlace: '', birthDate: '', nationality: 'ID', savedNationality: 'ID',
  nik: '', hasNik: false, clearNik: false,
  passportNumber: '', passportMask: '', passportIssuedAt: '', passportExpiry: '', clearPassport: false,
  address: EMPTY_ADDRESS, hadAddress: false, contact: EMPTY_CONTACT, email: '', isSelf: false, extra: {},
}

export function formFromCard(c: SavedPilgrimView): SavedPilgrimFormValue {
  const a = c.address
  return {
    fullName: c.fullName, gender: c.gender ?? '', birthPlace: c.birthPlace ?? '', birthDate: c.birthDate ?? '', nationality: c.nationality, savedNationality: c.nationality,
    nik: '', hasNik: c.nik !== null, clearNik: false,
    passportNumber: '', passportMask: c.passport?.number ?? '', passportIssuedAt: c.passport?.issuedAt ?? '', passportExpiry: c.passport?.expiry ?? '', clearPassport: false,
    address: a ? {
      type: a.type, fullAddress: a.fullAddress, postalCode: a.postalCode ?? '',
      provinceId: a.provinceId, regencyId: a.regencyId, districtId: a.districtId, villageId: a.villageId,
      countryCode: a.countryCode, city: a.city ?? '', stateRegion: a.stateRegion ?? '',
    } : EMPTY_ADDRESS,
    hadAddress: a !== null,
    contact: contactFromStored(c.phone ?? '', c.whatsapp ?? ''),
    email: c.email ?? '', isSelf: c.isSelf, extra: { ...c.extra },
  }
}

/** Badan permintaan untuk POST/PUT. Kolom yang tak boleh berubah tanpa diketik ulang (NIK, nomor paspor) tidak dikirim bila kosong. */
export function bodyFromForm(v: SavedPilgrimFormValue): SavedPilgrimInput {
  const wni = v.nationality === 'ID'
  const nik = !wni ? null : v.nik.trim() ? v.nik.trim() : v.hasNik && !v.clearNik ? undefined : null
  const dates = { issuedAt: v.passportIssuedAt || null, expiry: v.passportExpiry || null }
  // "Hapus data paspor" menang atas tanggal yang masih ada di state (kolomnya disembunyikan) — kalau tidak, server membaca "nomor tetap".
  const passport = v.clearPassport && !v.passportNumber.trim() ? null
    : v.passportNumber.trim()
    ? { number: v.passportNumber.trim(), ...dates }
    : v.passportMask && !v.clearPassport ? dates
    : dates.issuedAt || dates.expiry ? dates // nomor wajib — server menjawab "Nomor paspor wajib diisi"
    : null
  const address = v.address.fullAddress.trim() ? v.address : v.hadAddress ? null : undefined
  const phone = e164FromCountry(v.contact.phoneCountryCode, v.contact.phone) || null
  const whatsapp = e164FromCountry(v.contact.whatsappCountryCode, v.contact.whatsapp) || null
  return {
    fullName: v.fullName.trim(),
    gender: v.gender || null,
    birthPlace: v.birthPlace.trim() || null,
    birthDate: v.birthDate,
    nationality: v.nationality,
    ...(nik !== undefined ? { nik } : {}),
    passport,
    ...(address !== undefined ? { address } : {}),
    phone, whatsapp,
    email: v.email.trim() || null,
    isSelf: v.isSelf,
    extra: v.extra,
  }
}

export const canSubmitPilgrim = (v: SavedPilgrimFormValue) => v.fullName.trim().length >= 2 && v.birthDate !== ''

/** Nilai kolom bawaan sudah terisi di formulir (NIK/paspor tersimpan dihitung terisi). */
function roleFilled(v: SavedPilgrimFormValue, role: ManifestRole): boolean {
  switch (role) {
    case 'display_name': return v.fullName.trim().length >= 2
    case 'gender': return v.gender !== ''
    case 'birth_place': return v.birthPlace.trim() !== ''
    case 'birth_date': return v.birthDate !== ''
    case 'nationality': return v.nationality !== ''
    case 'nik': return v.nationality !== 'ID' || (isCalendarDate(v.birthDate) && isBaby(v.birthDate)) || v.nik.trim() !== '' || (v.hasNik && !v.clearNik) // WNA dan bayi tak ditagih NIK
    case 'passport_number': return v.passportNumber.trim() !== '' || (v.passportMask !== '' && !v.clearPassport)
    case 'passport_issued': return v.passportIssuedAt !== ''
    case 'passport_expiry': return v.passportExpiry !== ''
    case 'phone': return v.contact.phone.trim() !== ''
    case 'whatsapp': return v.contact.whatsapp.trim() !== ''
    case 'email': return v.email.trim() !== ''
    case 'address': return v.address.fullAddress.trim() !== ''
  }
}

/** Kolom WAJIB katalog yang masih kosong di formulir — popup "Jadikan saya jamaah" menahan simpan sampai terisi. */
export function missingRequired(v: SavedPilgrimFormValue, fields: readonly CardField[]): CardField[] {
  return fields.filter(f => f.required && !(f.role === null ? !isEmptyValue(v.extra[f.fieldKey]) : roleFilled(v, f.role as ManifestRole)))
}

/** Ada data jamaah (selain data akun: nama, kontak, email, alamat) yang diisi — Profil membuat kartu "Saya sendiri" hanya bila ya. */
export function hasCardOnlyData(v: SavedPilgrimFormValue): boolean {
  return v.gender !== '' || v.birthPlace.trim() !== '' || v.birthDate !== '' || v.nationality !== 'ID' || v.nik.trim() !== ''
    || v.passportNumber.trim() !== '' || v.passportIssuedAt !== '' || v.passportExpiry !== '' || Object.values(v.extra).some(x => !isEmptyValue(x))
}
