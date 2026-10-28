import { z } from 'zod'

// Penyesuaian total pesanan (docs/arsitektur-harga-terpadu.md §20). `.strict()` — kolom liar (mis. totalAfter/byUserId) ditolak.
export const adjustmentCreateSchema = z.object({
  amountIdr: z.number().finite('Jumlah tidak valid'),
  label: z.string().min(1, 'Label wajib diisi').max(120),
  reason: z.string().max(500).nullish(),
}).strict()

export const adjustmentReverseSchema = z.object({
  reason: z.string().max(500).nullish(),
}).strict()

/** Atur TOTAL harga jual pesanan (Fase 8). `.strict()`; angka ≤ 0 ditolak di sini DAN di lib/booking/adjustments.ts (bukan kebijakan harga — gratis tak boleh lahir dari salah ketik). */
export const bookingTotalSetSchema = z.object({
  totalIdr: z.number().finite('Total tidak valid').positive('Total harus lebih dari 0'),
  label: z.string().max(120).nullish(),
  reason: z.string().max(500).nullish(),
}).strict()

/** Ubah catatan internal penyesuaian lama (satu-satunya kolom yang boleh diedit). */
export const adjustmentReasonSchema = z.object({
  reason: z.string().max(500).nullable(),
}).strict()
