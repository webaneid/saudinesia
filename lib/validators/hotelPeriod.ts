import { z } from 'zod'

// Periode harga hotel (docs/arsitektur-hotel.md §12). Tanggal = tanggal kalender `YYYY-MM-DD` (ditulis lewat dbDateOf di lib/hotels/periods.ts).
const day = z.string().date('Tanggal tidak valid')

export const periodPricesSchema = z.object({
  vendorId: z.string().uuid('Vendor tidak valid'),
  currency: z.string().trim().min(3).max(3),
  rooms: z.array(z.object({
    roomTypeId: z.string().uuid(),
    cost: z.coerce.number().positive('Harga kamar harus lebih dari 0').max(1_000_000_000),
    totalQuota: z.coerce.number().int().min(0).max(100_000).default(0),
  }).strict()).min(1, 'Isi harga minimal 1 tipe kamar').max(50)
    .refine(r => new Set(r.map(x => x.roomTypeId)).size === r.length, 'Tipe kamar ganda'),
}).strict()

// Formulir periode lengkap (Tambah / Edit / Duplikat): tanggal + isi opsional. Mengirim `prices` = mengubah HPP → superadmin (route).
export const periodCreateSchema = z.object({ periodStart: day, periodEnd: day, prices: periodPricesSchema.optional() }).strict()
export const periodUpdateSchema = z.object({ periodStart: day.optional(), periodEnd: day.optional(), isActive: z.boolean().optional(), prices: periodPricesSchema.optional() }).strict()
export const periodDuplicateSchema = periodCreateSchema
