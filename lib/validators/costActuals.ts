import { z } from 'zod'

// Pengeluaran aktual vendor (docs/arsitektur-harga-terpadu.md §20). `.strict()` — kolom liar (recordedBy, amountIdr tak sah, voidedAt, dst.) ditolak; aturan bisnis di lib/costs/actuals.ts.
const base = {
  snapshotId: z.string().uuid().nullish(),
  vendorId: z.string().uuid('Pilih vendor yang valid'),
  component: z.string().min(1, 'Komponen wajib diisi').max(120),
  currency: z.string().length(3, 'Mata uang 3 huruf'),
  amount: z.number().finite().positive('Jumlah harus lebih dari 0'),
  amountIdr: z.number().finite().positive().nullish(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat YYYY-MM-DD'),
  isSettled: z.boolean().optional(),
  varianceNote: z.string().max(500).nullish(),
}
export const costActualCreateSchema = z.object(base).strict()
export const costActualUpdateSchema = z.object({
  vendorId: base.vendorId.optional(), component: base.component.optional(), currency: base.currency.optional(), amount: base.amount.optional(),
  amountIdr: base.amountIdr, paidAt: base.paidAt.optional(), isSettled: base.isSettled, varianceNote: base.varianceNote,
}).strict()
export const costActualVoidSchema = z.object({ reason: z.string().min(3, 'Alasan wajib diisi').max(500) }).strict()
