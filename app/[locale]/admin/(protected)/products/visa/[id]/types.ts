import type { VisaRequirement } from '@/lib/types/visa'

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
  // docs/arsitektur-dokumen.md §4 — sumber kebenaran syarat dokumen (Json `requirements` lama sudah deprecated)
  documentRequirements: VisaRequirement[]
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

