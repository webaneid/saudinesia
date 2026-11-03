import type { PilgrimReviewStatus } from '@prisma/client'

// Status pengajuan jamaah booking (docs/arsitektur-jamaah.md §8.4) — konstanta murni, aman di server dan klien.

/** Selama diajukan/terverifikasi, data jamaah booking dikunci: tautkan/perbarui/lepas kartu dan edit data ditolak (kembalikan dulu). */
export const REVIEW_LOCKED: readonly PilgrimReviewStatus[] = ['submitted', 'verified']
export const isReviewLocked = (s: PilgrimReviewStatus) => REVIEW_LOCKED.includes(s)
export const REVIEW_LOCKED_MESSAGE = 'Data jamaah ini sedang/sudah diperiksa — minta petugas mengembalikannya dulu sebelum mengubah'

export const REVIEW_LABEL: Record<PilgrimReviewStatus, string> = {
  draft: 'Belum diajukan',
  submitted: 'Menunggu pemeriksaan',
  needs_revision: 'Perlu perbaikan',
  verified: 'Terverifikasi',
}

export const REVIEW_TONE: Record<PilgrimReviewStatus, 'muted' | 'warning' | 'destructive' | 'success'> = {
  draft: 'muted',
  submitted: 'warning',
  needs_revision: 'destructive',
  verified: 'success',
}

export const REVIEW_NOTE_MAX = 2000
