// Alamat → satu baris teks (invoice, kop perusahaan). Urutan sama untuk semua pemakai: jalan, desa/kelurahan, kecamatan, kab/kota, provinsi, kode pos; luar negeri: jalan, kota, wilayah, negara.
type Named = { name: string } | null
export type AddressWithNames = {
  type: 'domestic' | 'international'
  fullAddress: string
  postalCode: string | null
  city: string | null
  stateRegion: string | null
  countryCode: string | null
  village?: Named
  district?: Named
  regency?: Named
  province?: Named
}

export function formatAddressLine(a: AddressWithNames | null | undefined): string {
  if (!a) return ''
  const parts = a.type === 'domestic'
    ? [a.fullAddress, a.village?.name, a.district?.name, a.regency?.name, a.province?.name, a.postalCode]
    : [a.fullAddress, a.city, a.stateRegion, a.countryCode]
  return parts.filter((x): x is string => !!x && x.trim() !== '').join(', ')
}
