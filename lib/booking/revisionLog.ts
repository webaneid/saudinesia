import type { Prisma } from '@prisma/client'

// Riwayat revisi booking terbit (docs/arsitektur-booking-engine-v2.md §10.4 6b, D13) — SATU penulis `booking_revisions` (append-only di DB).
// Dipakai revisi isi (lib/booking/revise.ts) dan atur total (lib/booking/adjustments.ts). `summary` TANPA data pribadi: label produk, jumlah, "Jamaah ke-N".

export type RevisionChange = {
  kind: 'add' | 'remove' | 'replace' | 'price' | 'pilgrim_add' | 'pilgrim_remove' | 'visa_change' | 'dates' | 'total'
  label: string
  detail?: string
}

export async function recordRevision(tx: Prisma.TransactionClient, r: {
  bookingId: string; revision: number; kind: 'items' | 'total'; reason: string | null; summary: RevisionChange[]
  totalBefore: number; totalAfter: number; taxBefore: number; taxAfter: number; byUserId: string
}): Promise<void> {
  await tx.bookingRevision.create({
    data: {
      bookingId: r.bookingId, revision: r.revision, kind: r.kind, reason: r.reason, summary: r.summary as Prisma.InputJsonValue,
      totalBefore: r.totalBefore, totalAfter: r.totalAfter, taxBefore: r.taxBefore, taxAfter: r.taxAfter, byUserId: r.byUserId,
    },
  })
}
