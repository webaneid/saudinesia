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

// Rekening penerimaan Platform Provider (Fase 13e-1, §5e). Nomor rekening = angka saja (spasi/tanda hubung dibuang).
const accountNumber = z.string().transform(v => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[0-9]{4,40}$/, { error: 'Nomor rekening 4–40 angka' }))
export const providerBankAccountSchema = z.object({
  bankName: z.string().trim().min(2, { error: 'Nama bank wajib diisi' }).max(100),
  accountNumber,
  accountHolder: z.string().trim().min(2, { error: 'Nama pemilik rekening wajib diisi' }).max(120),
  isActive: z.boolean().optional(),
}).strict()
export const providerBankAccountUpdateSchema = providerBankAccountSchema.partial().strict()
export type ProviderBankAccountInput = z.infer<typeof providerBankAccountSchema>

// Pencairan bagi hasil (Fase 13e-1). Akun kas asal = `bank:<id>` | `cash` (QRIS ditolak di server); rupiah bulat.
export const revenueSharePayoutSchema = z.object({
  amount: z.number().int({ error: 'Jumlah dalam rupiah bulat' }).positive({ error: 'Jumlah harus lebih dari 0' }).max(10_000_000_000, { error: 'Jumlah melebihi batas wajar' }),
  paidAt: z.iso.datetime({ error: 'Waktu bayar tidak valid' }).transform(v => new Date(v)),
  cashAccount: z.string().regex(/^(cash|bank:[0-9a-f-]{36})$/, { error: 'Pilih akun kas asal' }),
  recipientAccountId: z.uuid({ error: 'Pilih rekening tujuan' }),
  // Versi rekening tujuan yang DILIHAT pencatat (updatedAt dari pilihan formulir): berubah sebelum disimpan → 409 (SEC-292).
  recipientVersion: z.iso.datetime({ error: 'Muat ulang pilihan rekening tujuan' }).transform(v => new Date(v)),
  note: z.string().trim().max(200).nullish().transform(v => v || null),
}).strict()
export const revenueSharePayoutVoidSchema = z.object({
  action: z.literal('void'),
  reason: z.string().trim().min(3, { error: 'Alasan pembatalan wajib diisi (minimal 3 karakter)' }).max(200),
}).strict()
