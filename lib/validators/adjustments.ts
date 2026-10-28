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
