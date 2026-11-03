import { z } from 'zod'

// Masukan route gudang identitas jamaah (docs/arsitektur-jamaah.md §4.4, Fase 8). `.strict()`: kolom liar ditolak (SEC-03).
export const identityRevealSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('nik') }).strict(),
  z.object({ field: z.literal('passport'), cardId: z.string().uuid() }).strict(),
])
export const identityCardActionSchema = z.object({ action: z.enum(['confirm', 'detach', 'pin']) }).strict()
/** `keep` = identitas yang DIPAKAI: `this` (identitas di URL) atau `other`. */
export const identityMergeSchema = z.object({ otherId: z.string().uuid(), keep: z.enum(['this', 'other']) }).strict()
export const identityLinkSchema = z.object({ identityId: z.string().uuid() }).strict()
export const identityFilterSchema = z.enum(['all', 'conflict', 'unverified']).catch('all')
