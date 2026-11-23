import type { RequirementView } from '@/lib/documents/completeness'
import type { ManifestFieldLike } from '@/components/admin/manifest/manifestRows'

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
  // Kolom data jamaah (lib/manifest/fields.ts, docs/arsitektur-manifest.md §9) — tetap dimuat API, sementara tidak ditampilkan di editor (page.tsx)
  manifestFields: ManifestFieldLike[]
  manifestFieldsUsed: boolean
}
