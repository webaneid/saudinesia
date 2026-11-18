import { z } from 'zod'

// Setelan bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md, Fase 13a). Persen 0..50, dua desimal; `expectedId` = versi yang dilihat
// formulir (null = belum ada versi) — basi → 409.
export const revenueShareSettingSchema = z.object({
  percent: z.number({ error: 'Persen wajib angka' }).min(0, { error: 'Persen minimal 0' }).max(50, { error: 'Persen maksimal 50' })
    .refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, { error: 'Persen maksimal dua desimal' }), // bukan ===: 1.1 × 100 = 110.00000000000001 (SEC-275)
  basis: z.enum(['margin', 'markup'], { error: 'Dasar bagi hasil tidak dikenal' }),
  note: z.string().trim().max(200, { error: 'Catatan maksimal 200 karakter' }).nullish(),
  expectedId: z.string().uuid({ error: 'Versi tidak valid' }).nullable(),
}).strict()

export type RevenueShareSettingInput = z.infer<typeof revenueShareSettingSchema>
