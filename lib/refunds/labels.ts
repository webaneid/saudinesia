import type { RefundSource, RefundStatus } from '@prisma/client'

// Label refund (murni — aman di klien). Satu tempat untuk daftar, detail, dan panel booking.
export const REFUND_STATUS: Record<RefundStatus, { label: string; tone: 'warning' | 'accent' | 'ok' | 'danger' }> = {
  pending: { label: 'Diusulkan', tone: 'warning' }, approved: { label: 'Disetujui', tone: 'accent' }, paid: { label: 'Dibayar', tone: 'ok' }, rejected: { label: 'Ditolak', tone: 'danger' },
}
export const REFUND_SOURCE_LABEL: Record<RefundSource, string> = { overpayment: 'Kelebihan bayar', cancellation: 'Pembatalan' }
