import { z } from 'zod'

// Masukan API harga (docs/arsitektur-harga-terpadu.md §16). `.strict()`: kolom tak dikenal (mass assignment) ditolak.
const OWNER_TYPES = ['visa', 'flight', 'hotel', 'transport', 'muthowif', 'package', 'tour_package', 'haji', 'catering', 'hotel_service'] as const
export const priceOwnerTypeSchema = z.enum(OWNER_TYPES)

const pointKey = {
  ownerType: priceOwnerTypeSchema,
  ownerId: z.string().min(1).max(100),
  variantKey: z.string().max(100).default(''),
}

export const pricePointQuerySchema = z.object({ ownerType: priceOwnerTypeSchema, ownerId: z.string().min(1).max(100) }).strict()

export const setManualSellSchema = z.object({
  ...pointKey,
  sellIdr: z.coerce.number().finite(),
  note: z.string().max(500).nullish(),
}).strict()

export const clearManualSellSchema = z.object({ ...pointKey, note: z.string().max(500).nullish() }).strict()

export const setManualCostSchema = z.object({
  ...pointKey,
  costIdr: z.coerce.number().finite().nullable(),
}).strict()

export const marginHealthQuerySchema = z.object({
  filter: z.enum(['issues', 'all', 'loss', 'thin', 'no_cost', 'unpriced']).catch('issues'),
  ownerType: priceOwnerTypeSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
})
