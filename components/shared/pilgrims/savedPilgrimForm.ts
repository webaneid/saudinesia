import { EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { EMPTY_CONTACT, contactFromStored, type ContactValue } from '@/components/shared/ContactPicker'
import { e164FromCountry } from '@/lib/utils/phone'
import type { SavedPilgrimView } from '@/lib/pilgrims/service'
import type { SavedPilgrimInput } from '@/lib/validators/pilgrims'

// Nilai formulir kartu jamaah (docs/arsitektur-jamaah.md §5.1) — murni, dipakai halaman jamaah dan admin.
// NIK dan nomor paspor tak pernah dikirim balik dari server: kolom kosong pada kartu yang sudah punya nilai = "tetap" (kolom tak dikirim).

export type SavedPilgrimFormValue = {
  fullName: string
  gender: '' | 'male' | 'female'
  birthPlace: string
  birthDate: string
  nationality: string
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
}

export const EMPTY_PILGRIM_FORM: SavedPilgrimFormValue = {
  fullName: '', gender: '', birthPlace: '', birthDate: '', nationality: 'ID',
  nik: '', hasNik: false, clearNik: false,
  passportNumber: '', passportMask: '', passportIssuedAt: '', passportExpiry: '', clearPassport: false,
  address: EMPTY_ADDRESS, hadAddress: false, contact: EMPTY_CONTACT, email: '', isSelf: false,
}

export function formFromCard(c: SavedPilgrimView): SavedPilgrimFormValue {
  const a = c.address
  return {
    fullName: c.fullName, gender: c.gender ?? '', birthPlace: c.birthPlace ?? '', birthDate: c.birthDate ?? '', nationality: c.nationality,
    nik: '', hasNik: c.nik !== null, clearNik: false,
    passportNumber: '', passportMask: c.passport?.number ?? '', passportIssuedAt: c.passport?.issuedAt ?? '', passportExpiry: c.passport?.expiry ?? '', clearPassport: false,
    address: a ? {
      type: a.type, fullAddress: a.fullAddress, postalCode: a.postalCode ?? '',
      provinceId: a.provinceId, regencyId: a.regencyId, districtId: a.districtId, villageId: a.villageId,
      countryCode: a.countryCode, city: a.city ?? '', stateRegion: a.stateRegion ?? '',
    } : EMPTY_ADDRESS,
    hadAddress: a !== null,
    contact: contactFromStored(c.phone ?? '', c.whatsapp ?? ''),
    email: c.email ?? '', isSelf: c.isSelf,
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
  }
}

export const canSubmitPilgrim = (v: SavedPilgrimFormValue) => v.fullName.trim().length >= 2 && v.birthDate !== ''
