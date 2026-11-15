import { z } from 'zod'

// Query laporan untung (docs/arsitektur-harga-terpadu.md §19). Tanggal divalidasi lebih lanjut oleh `periodBounds` (format, urutan, rentang); di sini hanya bentuk.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat YYYY-MM-DD')

export const profitQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
  scope: z.enum(['recognized', 'with_pending']).catch('recognized'),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
  onlyLoss: z.enum(['1', '0']).optional().catch(undefined),
})

export const varianceQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
  only: z.enum(['variance']).optional().catch(undefined),
})

// Buku kas (Fase 7b-1): filter dari URL — nilai asing diabaikan (daftar putih), bukan 400.
export const cashBookQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
  account: z.uuid().optional().catch(undefined),
  direction: z.enum(['in', 'out']).optional().catch(undefined),
  component: z.enum(['pokok', 'ppn', 'kode_unik', 'kelebihan', 'refund', 'biaya_vendor', 'koreksi']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
})
