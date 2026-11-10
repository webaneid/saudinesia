import type { PilgrimReviewStatus } from '@prisma/client'
import type { FieldRow } from '@/lib/manifest/display'

// Bentuk slot jamaah (lib/pilgrims/slots.ts) — tipe murni supaya komponen klien tidak menarik rantai impor server (lib/pii, SEC-170).

export type SlotDocument = { key: string; label: string; required: boolean; state: string; reusable: boolean }

export type PilgrimSlot = {
  id: string
  /** Nomor urut slot (1-based) — tetap walau slot lain dikosongkan. */
  no: number
  name: string | null
  filled: boolean
  card: { id: string; name: string } | null
  data: { filled: number; required: number; complete: boolean }
  docs: { done: number; required: number }
  /** Data wajib lengkap DAN dokumen wajib siap — siap diajukan/diperiksa. */
  ready: boolean
  reviewStatus: PilgrimReviewStatus
  rows: FieldRow[]
  documents: SlotDocument[]
  /** Booking berrombongan: nama rombongan jamaah (diisi halaman dari label hidup, lib/booking/groups.ts `groupView`). */
  group?: string
}

