import { z } from 'zod'

// Kuota tanggal transport (docs/arsitektur-transportasi.md §10). Kursi boleh melebihi kapasitas satu kendaraan: operator bisa menyediakan beberapa unit di tanggal yang sama.
export const MAX_QUOTA_SEATS = 10_000

const seats = z.number().int('Jumlah kursi harus bilangan bulat').min(1, 'Jumlah kursi minimal 1').max(MAX_QUOTA_SEATS, `Jumlah kursi maksimal ${MAX_QUOTA_SEATS}`)

export const openQuotasSchema = z.object({
  pricingId:  z.string().uuid(),
  from:       z.string().date(),
  to:         z.string().date(),
  totalSeats: seats,
}).strict()

export const updateQuotaSchema = z.object({ totalSeats: seats }).strict()

export const quotaListQuerySchema = z.object({
  tripId:    z.string().uuid(),
  pricingId: z.string().uuid().optional(),
})

export type OpenQuotasInput = z.infer<typeof openQuotasSchema>
