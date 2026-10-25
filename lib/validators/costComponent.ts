import { z } from 'zod'

// Komponen Biaya bebas (docs/arsitektur-komponen-biaya.md §3.1). `.strict()`: kolom lain (mis. `productType`, `isActive`) tidak boleh
// bisa diubah dari body — pemilik komponen ditentukan oleh path, bukan input.
export const costComponentCreateSchema = z.object({
  costComponent: z.string().trim().min(1).max(120),
  vendorId:      z.string().min(1),
  currency:      z.string().trim().min(1).max(8),
  cost:          z.coerce.number().positive(),
}).strict()

export const costComponentUpdateSchema = z.object({
  costComponent: z.string().trim().min(1).max(120).optional(),
  vendorId:      z.string().min(1).optional(),
  currency:      z.string().trim().min(1).max(8).optional(),
  cost:          z.coerce.number().positive().optional(),
}).strict()

export const costComponentSimulateSchema = z.object({
  cost:     z.coerce.number().positive(),
  currency: z.string().trim().min(1).max(8),
})

export type CostComponentCreate = z.infer<typeof costComponentCreateSchema>
export type CostComponentUpdate = z.infer<typeof costComponentUpdateSchema>
