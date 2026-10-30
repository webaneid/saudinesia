import { z } from 'zod'

// Aturan ketergantungan produk visa (docs/arsitektur-booking-engine-v2.md D5, §4.1, §10.2): komponen yang WAJIB ada di booking yang sama.
// Transport boleh dipersempit ke kategori jurusan (`TransportTrip.category`, mis. `airport`) atau trip tertentu; tanpa filter = transport apa pun.
export const requiredComponentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('flight') }).strict(),
  z.object({ type: z.literal('hotel') }).strict(),
  z.object({
    type: z.literal('transport'),
    categories: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    tripIds: z.array(z.string().uuid()).max(50).optional(),
  }).strict(),
])

export const visaRequiredComponentsSchema = z.array(requiredComponentSchema).max(3)
  .refine(list => new Set(list.map(c => c.type)).size === list.length, 'Setiap komponen hanya boleh disebut sekali')

export type RequiredComponent = z.infer<typeof requiredComponentSchema>

/** Baca kolom JSON `VisaProduct.requiredComponents`. Data tak sah dibaca sebagai "tanpa aturan" + `invalid: true` supaya pemanggil bisa menolak, bukan diam-diam meloloskan. */
export function parseRequiredComponents(json: unknown): { components: RequiredComponent[]; invalid: boolean } {
  const parsed = visaRequiredComponentsSchema.safeParse(json)
  return parsed.success ? { components: parsed.data, invalid: false } : { components: [], invalid: true }
}
