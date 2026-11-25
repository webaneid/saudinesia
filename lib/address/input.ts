// Murni (aman di klien) — satu aturan untuk semua formulir ber-`AddressPicker`: apa yang dikirim ke server (docs/arsitektur-alamat.md §10 E/F).

type Input = {
  fullAddress: string; postalCode: string
  provinceId: string | null; regencyId: string | null; districtId: string | null; villageId: string | null
  countryCode: string | null; city: string; stateRegion: string; mapsUrl?: string
}

/** Ada isian apa pun — juga yang belum lengkap (mis. provinsi dipilih tanpa Alamat Lengkap). */
export const hasAddressInput = (a: Input): boolean =>
  [a.fullAddress, a.postalCode, a.provinceId, a.regencyId, a.districtId, a.villageId, a.countryCode, a.city, a.stateRegion, a.mapsUrl].some(v => !!v?.trim())

/**
 * Nilai kolom `address` untuk API: isian → objek; Alamat Lengkap dikosongkan padahal sudah ada alamat tersimpan → `null` (hapus);
 * belum ada apa pun → `undefined` (tak dikirim). Isian sebagian TETAP dikirim supaya server menolaknya — tak pernah dibuang diam-diam.
 */
export function addressForBody<T extends Input>(a: T, saved: boolean): T | null | undefined {
  if (a.fullAddress.trim()) return a
  if (saved) return null
  return hasAddressInput(a) ? a : undefined
}
