import type { PilgrimReviewStatus, VisaStatus } from '@prisma/client'
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
  /** Produk pesanan meminta sesuatu dari jamaah ini (kolom Data Jamaah atau dokumen). `false` = tak ada kewajiban (docs/arsitektur-data-jamaah.md §3.3). */
  needed: boolean
  /** Data wajib lengkap DAN dokumen wajib siap — siap diajukan/diperiksa. */
  ready: boolean
  reviewStatus: PilgrimReviewStatus
  /** Status visa jamaah ini (null = tanpa visa) — kolom "Visa" tabel (docs/arsitektur-visa.md §9). */
  visa: VisaStatus | null
  rows: FieldRow[]
  documents: SlotDocument[]
  /** Booking berrombongan: nama rombongan jamaah (diisi halaman dari label hidup, lib/booking/groups.ts `groupView`). */
  group?: string
}

