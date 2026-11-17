import { z } from 'zod'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'

// Transfer antar akun kas (Fase 12b, §10.14). `.strict()`; akun dinilai di lib/cash/transfers.ts (ada, bukan QRIS, berbeda) di dalam transaksi.
const ref = z.string().regex(/^(cash|(account|bank):[0-9a-f-]{36})$/, 'Pilih akun')
const rupiah = (label: string) => z.number().int(`${label} dalam rupiah bulat`).max(MAX_PRICE_IDR, `${label} melebihi batas wajar`)

export const cashTransferCreateSchema = z.object({
  from: ref,
  to: ref,
  amount: rupiah('Jumlah').positive('Jumlah harus lebih dari 0'),
  fee: rupiah('Biaya transfer').min(0, 'Biaya transfer tidak boleh negatif').default(0),
  /** instan UTC ISO dari `DateTimeField` */
  transferredAt: z.iso.datetime({ error: 'Waktu transfer tidak valid' }).transform(v => new Date(v)),
  note: z.string().trim().max(200).nullish().transform(v => v || null),
}).strict().refine(v => v.from !== v.to, { error: 'Akun asal dan tujuan harus berbeda', path: ['to'] })

export const cashTransferActionSchema = z.object({
  action: z.literal('void'),
  reason: z.string().trim().min(3, 'Alasan pembatalan wajib diisi (minimal 3 karakter)').max(200),
}).strict()

// Daftar: nilai asing diabaikan (daftar putih).
export const cashTransferListSchema = z.object({
  status: z.enum(['active', 'void']).optional().catch(undefined),
}) // halaman/limit lewat parseListParams
