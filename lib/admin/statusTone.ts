import type { BadgeTone } from '@/components/admin/ui/Badge'

// Satu tempat untuk memetakan status data -> tone Badge admin (lihat docs/admin-ui-kit.md).

export const BOOKING_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  awaiting_payment: 'warning',
  payment_review: 'accent',
  confirmed: 'ok',
  in_progress: 'accent',
  completed: 'ok',
  cancelled: 'danger',
  expired: 'danger',
}

export const VISA_TONE: Record<string, BadgeTone> = {
  pending_documents: 'danger',
  documents_complete: 'accent',
  submitted_to_syarikah: 'warning',
  in_review: 'accent',
  issued: 'ok',
  rejected: 'danger',
  withdrawn: 'neutral',
}

export const DELETION_REQUEST_TONE: Record<string, BadgeTone> = {
  pending: 'accent',
  completed: 'ok',
  rejected: 'danger',
}
