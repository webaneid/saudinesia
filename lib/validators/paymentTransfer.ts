import { z } from 'zod'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'

// Data transfer yang dikirim pelanggan bersama bukti (Fase 7a, docs/arsitektur-booking-engine-v2.md §10.7 / D10). Dibaca dari isian multipart
// (semua teks), jadi angka diparse di sini. Pesan = teks katalog `apiErrors` (id) supaya `zodFailure` memetakannya ke kode untuk pelanggan.
// Batas nominal yang bergantung tagihan (DP minimum, sisa) dinilai `paymentLimits` di dalam kunci booking, bukan di sini.

const text = (max: number, message: string) => z.string().trim().min(2, { error: message }).max(max, { error: message })

export const paymentTransferSchema = z.object({
  amount: z.string().trim()
    .regex(/^\d{1,10}$/, { error: 'Nominal transfer tidak valid' })
    .transform(Number)
    .refine(n => n > 0 && n <= MAX_PRICE_IDR, { error: 'Nominal transfer tidak valid' }),
  /** `YYYY-MM-DDTHH:mm` dari `DateTimeField`, ditafsirkan di zona aplikasi oleh pemanggil (`parseAppDateTime`). */
  transferredAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, { error: 'Tanggal dan jam transfer tidak valid' }),
  /** Kunci rekening tujuan dari snapshot invoice (id rekening di setelan). */
  destination: z.string().trim().min(1, { error: 'Pilih rekening tujuan' }).max(100, { error: 'Pilih rekening tujuan' }),
  senderBank: text(100, 'Isi nama bank pengirim'),
  senderAccountName: text(100, 'Isi nama pemilik rekening pengirim'),
  note: z.string().trim().max(500, { error: 'Catatan terlalu panjang (maksimal 500 karakter)' }).optional(),
}).strict()

export type PaymentTransferInput = z.infer<typeof paymentTransferSchema>
