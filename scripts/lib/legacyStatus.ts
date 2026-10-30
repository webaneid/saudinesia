import type { BookingStatus } from '@prisma/client'

// Uji yang ditulis sebelum siklus hidup v2 (Fase 3) memakai nama status v1. Peta ini menerjemahkannya ke data tersimpan yang sebenarnya:
// `awaiting_payment` = hidup tanpa konfirmasi; `confirmed`/`active`(berjalan) = hidup + `confirmedAt`. `payment_review` juga hidup tanpa konfirmasi —
// bukti yang menunggu adalah baris `payments` berstatus `pending` (tambahkan sendiri bila uji membutuhkannya).
export type LegacyBookingStatus = 'awaiting_payment' | 'payment_review' | 'confirmed' | 'active' | 'completed' | 'cancelled'

export function legacyBookingState(s: LegacyBookingStatus): { status: BookingStatus; confirmedAt: Date | null } {
  switch (s) {
    case 'awaiting_payment':
    case 'payment_review': return { status: 'active', confirmedAt: null }
    case 'confirmed':
    case 'active': return { status: 'active', confirmedAt: new Date() }
    case 'completed': return { status: 'completed', confirmedAt: new Date() }
    case 'cancelled': return { status: 'cancelled', confirmedAt: null }
  }
}
