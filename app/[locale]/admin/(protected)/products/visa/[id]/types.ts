import type { RequirementView } from '@/lib/documents/completeness'

export type ProductDetail = {
  id: string
  name: string
  country: string
  visaType: string
  description: string | null
  price: number | string
  priceLabel: string | null
  processDays: number
  isActive: boolean
  durationFeeRules?: unknown
  requiredComponents: unknown // aturan ketergantungan (lib/validators/visa.ts)
  // Syarat dokumen produk (lib/documents/requirements.ts, docs/arsitektur-jamaah.md §7.6)
  documentRequirements: RequirementView[]
}

export type InfoForm = {
  name: string
  country: string
  visaType: string
  /** Teks kaya: JSON dokumen (string) atau teks polos lama. */
  description: string
  processDays: string
  isActive: boolean
}

/** Hasil hapus: null = terhapus (halaman berpindah); `notice` = dinonaktifkan karena dirujuk; `error` = gagal. */
export type DeleteResult = { error: string } | { notice: string } | null

