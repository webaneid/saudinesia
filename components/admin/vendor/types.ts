import type { AddressValue } from '@/components/shared/AddressPicker'
import { EMPTY_ADDRESS } from '@/components/shared/AddressPicker'
import { EMPTY_CONTACT, type ContactValue } from '@/components/shared/ContactPicker'

// Tipe sisi-klien untuk menu Vendor (ADR-0003). Bentuknya mengikuti `VendorDto` di lib/vendors/service.ts, tetapi hanya field yang dipakai UI —
// objek dari server (yang membawa tanggal) tetap kompatibel secara struktural.

export type VendorCategoryOption = { id: string; slug: string; name: string; isActive: boolean }

export type VendorAddressRecord = {
  type: 'domestic' | 'international'; fullAddress: string; postalCode: string | null
  provinceId: string | null; regencyId: string | null; districtId: string | null; villageId: string | null
  countryCode: string | null; city: string | null; stateRegion: string | null
} | null

export type VendorRecord = {
  id: string
  name: string
  countryCode: string
  isActive: boolean
  isSystem: boolean
  contactName: string | null
  phoneCountryCode: string | null
  phone: string | null
  whatsappCountryCode: string | null
  whatsapp: string | null
  email: string | null
  website: string | null
  notes: string | null
  categories: VendorCategoryOption[]
  address: VendorAddressRecord
}

export type VendorFormState = {
  name: string
  countryCode: string | null // null hanya pada formulir baru yang belum memilih negara
  categoryIds: string[]
  contactName: string
  contact: ContactValue
  website: string
  notes: string
  address: AddressValue
}

export const EMPTY_VENDOR_FORM: VendorFormState = {
  name: '', countryCode: null, categoryIds: [], contactName: '', contact: EMPTY_CONTACT, website: '', notes: '', address: EMPTY_ADDRESS,
}

function toAddressValue(a: VendorAddressRecord): AddressValue {
  if (!a) return EMPTY_ADDRESS
  return {
    type: a.type, fullAddress: a.fullAddress, postalCode: a.postalCode ?? '',
    provinceId: a.provinceId, regencyId: a.regencyId, districtId: a.districtId, villageId: a.villageId,
    countryCode: a.countryCode, city: a.city ?? '', stateRegion: a.stateRegion ?? '',
  }
}

export function vendorToFormState(v: VendorRecord): VendorFormState {
  return {
    name: v.name,
    countryCode: v.countryCode,
    categoryIds: v.categories.map(c => c.id),
    contactName: v.contactName ?? '',
    contact: {
      phoneCountryCode: v.phoneCountryCode ?? 'ID', phone: v.phone ?? '',
      whatsappCountryCode: v.whatsappCountryCode ?? v.phoneCountryCode ?? 'ID', whatsapp: v.whatsapp ?? '',
      email: v.email ?? '',
    },
    website: v.website ?? '',
    notes: v.notes ?? '',
    address: toAddressValue(v.address),
  }
}

/**
 * Isi formulir → body API. Kode negara hanya dikirim bila nomornya ada (ContactPicker selalu membawa default 'ID'; nomor kosong + kode = data
 * yatim yang ditolak server). Alamat kosong tidak dikirim.
 */
export function formStateToBody(f: VendorFormState): Record<string, unknown> {
  const phone = f.contact.phone.trim()
  const whatsapp = f.contact.whatsapp.trim()
  return {
    name: f.name.trim(),
    countryCode: f.countryCode,
    categoryIds: f.categoryIds,
    contactName: f.contactName.trim(),
    phoneCountryCode: phone ? f.contact.phoneCountryCode : null,
    phone,
    whatsappCountryCode: whatsapp ? f.contact.whatsappCountryCode : null,
    whatsapp,
    email: f.contact.email.trim(),
    website: f.website.trim(),
    notes: f.notes.trim(),
    ...(f.address.fullAddress.trim() ? { address: f.address } : {}),
  }
}
