import type { ForceMajeureCategory, RefundApprovalMode, RefundSource, RefundStatus } from '@prisma/client'

// Label refund (murni — aman di klien). Satu tempat untuk daftar, detail, panel booking, dan Kebijakan Refund.
export const REFUND_STATUS: Record<RefundStatus, { label: string; tone: 'warning' | 'accent' | 'ok' | 'danger' }> = {
  pending: { label: 'Diusulkan', tone: 'warning' }, approved: { label: 'Disetujui', tone: 'accent' }, paid: { label: 'Dibayar', tone: 'ok' }, rejected: { label: 'Ditolak', tone: 'danger' },
}
export const REFUND_SOURCE_LABEL: Record<RefundSource, string> = { overpayment: 'Kelebihan bayar', cancellation: 'Pembatalan' }

/** Kategori force-majeure (docs/rencana-force-majeure.md FM3). */
export const FORCE_MAJEURE_LABEL: Record<ForceMajeureCategory, string> = {
  visa_rejected: 'Visa ditolak', medical: 'Darurat medis / meninggal', saudi_policy: 'Kebijakan pemerintah Saudi', other: 'Lainnya',
}
/** Pilihan untuk `ChoiceSelect` (nilai '' = bukan force-majeure, lewat `clearable`). */
export const FORCE_MAJEURE_OPTIONS = (Object.keys(FORCE_MAJEURE_LABEL) as ForceMajeureCategory[]).map(k => ({ id: k, label: FORCE_MAJEURE_LABEL[k] }))
export const forceMajeureOf = (v: string): ForceMajeureCategory | null => (v in FORCE_MAJEURE_LABEL ? (v as ForceMajeureCategory) : null)

/** Kapan refund pembatalan wajib disetujui superadmin (setelan FM1). */
export const APPROVAL_MODE_LABEL: Record<RefundApprovalMode, { label: string; hint: string }> = {
  above_policy: { label: 'Di atas kebijakan pembatalan', hint: 'Refund pembatalan yang melebihi kebijakan (refund force-majeure) wajib superadmin. Sesuai kebijakan cukup manager.' },
  above_half: { label: 'Di atas 50% tagihan booking', hint: 'Total refund booking lebih dari separuh tagihan wajib superadmin, terlepas dari kebijakan.' },
  either: { label: 'Salah satunya', hint: 'Wajib superadmin bila di atas kebijakan ATAU di atas 50% tagihan.' },
}
