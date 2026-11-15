import { z } from 'zod'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'

// Data transfer yang dikirim pelanggan bersama bukti (Fase 7a, docs/arsitektur-booking-engine-v2.md §10.7 / D10). Dibaca dari isian multipart
// (semua teks), jadi angka diparse di sini. Pesan = teks katalog `apiErrors` (id) supaya `zodFailure` memetakannya ke kode untuk pelanggan.
// Batas nominal yang bergantung tagihan (DP minimum, sisa) dinilai `paymentLimits` di dalam kunci booking, bukan di sini.

const text = (max: number, message: string) => z.string({ error: message }).trim().min(2, { error: message }).max(max, { error: message })

export const paymentTransferSchema = z.object({
  amount: z.string({ error: 'Nominal transfer tidak valid' }).trim()
    .regex(/^\d{1,10}$/, { error: 'Nominal transfer tidak valid' })
    .transform(Number)
    .refine(n => n > 0 && n <= MAX_PRICE_IDR, { error: 'Nominal transfer tidak valid' }),
  /** Instan UTC ISO dari `DateTimeField` (formulir menafsirkan masukan di zona aplikasi). Rentang wajar (tak di masa depan) dinilai route. */
  transferredAt: z.iso.datetime({ error: 'Tanggal dan jam transfer tidak valid' }).transform(v => new Date(v)),
  /** Urutan rekening tujuan dalam `bookingPayTo` (snapshot invoice tak punya id); route memetakannya ke label yang disimpan. */
  destination: z.string({ error: 'Pilih rekening tujuan' }).trim().regex(/^\d{1,2}$/, { error: 'Pilih rekening tujuan' }).transform(Number),
  senderBank: text(100, 'Isi nama bank pengirim'),
  senderAccountName: text(100, 'Isi nama pemilik rekening pengirim'),
  note: z.string().trim().max(500, { error: 'Catatan terlalu panjang (maksimal 500 karakter)' }).optional(),
}).strict()

export type PaymentTransferInput = z.infer<typeof paymentTransferSchema>

/** Kolom teks yang boleh menyertai berkas bukti (daftar putih `readFileWithFields`) — diturunkan dari skema, bukan daftar kedua. */
export const TRANSFER_KEYS: ReadonlySet<string> = new Set(Object.keys(paymentTransferSchema.shape))
