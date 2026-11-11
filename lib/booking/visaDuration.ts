// Teks durasi visa berjenjang (audit front-end 2026-11-11): pelanggan memilih JENJANG "1–30 hari", tetapi yang tersimpan hanya hari awal
// jenjang (`selectedDurationDays`) — dulu ditampilkan "1 hari". Teks diambil dari kunci varian titik harga yang benar-benar dipakai
// (`days:min-max`, lib/pricing/engine/owners/visa.ts). Murni — aman di server dan klien.

/** "30 hari" atau "1–30 hari". */
export const visaTierText = (minDays: number, maxDays: number): string => (minDays === maxDays ? `${minDays} hari` : `${minDays}–${maxDays} hari`)

/** Rentang jenjang dari kunci varian visa; `null` bila bukan kunci jenjang hari. Halaman berbahasa merangkai teksnya sendiri lewat pesan. */
export function visaTierRangeOfKey(variantKey: string): { min: number; max: number } | null {
  const m = /^days:(\d+)-(\d+)$/.exec(variantKey)
  return m ? { min: Number(m[1]), max: Number(m[2]) } : null
}

/** Teks jenjang (Indonesia — admin, invoice) dari kunci varian visa; `null` bila bukan kunci jenjang hari. */
export function visaTierTextOfKey(variantKey: string): string | null {
  const r = visaTierRangeOfKey(variantKey)
  return r ? visaTierText(r.min, r.max) : null
}
