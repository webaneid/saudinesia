import { z } from 'zod'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'

// Pembatalan admin + refund (Fase 7b-2a, docs/arsitektur-booking-engine-v2.md §10.10). `.strict()`; batas jumlah yang bergantung pada uang masuk dinilai di dalam kunci
// (lib/refunds/service.ts, lib/booking/adminCancel.ts), bukan di sini.
const amount = z.number().int('Jumlah dalam rupiah bulat').positive('Jumlah harus lebih dari 0').max(MAX_PRICE_IDR, 'Jumlah melebihi batas wajar')
const reason = z.string().trim().min(3, 'Alasan wajib diisi (minimal 3 karakter)').max(500)
const note = z.string().trim().max(500).nullish()

/** Force-majeure (docs/rencana-force-majeure.md): kategori atau null; hanya untuk refund pembatalan (dinilai di layanan). */
export const forceMajeureSchema = z.enum(['visa_rejected', 'medical', 'saudi_policy', 'other'], { error: 'Kategori force-majeure tidak dikenal' }).nullish()

export const adminCancelSchema = z.object({
  reason,
  decision: z.enum(['refund', 'retain', 'defer']).nullish(),
  refundAmount: amount.nullish(),
  forceMajeure: forceMajeureSchema,
  note,
}).strict()

export const cancelDecisionSchema = z.object({ decision: z.enum(['refund', 'retain']), refundAmount: amount.nullish(), forceMajeure: forceMajeureSchema, note }).strict()

/** Rekening tujuan pelanggan (SEC-244, §10.13): ketiganya wajib bila dikirim; nomor = angka (spasi/strip diizinkan) — bentuk sama dengan CHECK DB. */
export const refundRecipientSchema = z.object({
  bank: z.string().trim().min(2, 'Nama bank wajib diisi').max(80),
  accountNumber: z.string().trim().regex(/^[0-9][0-9 -]{3,38}[0-9]$/, 'Nomor rekening hanya angka (5–40 karakter)'),
  accountName: z.string().trim().min(2, 'Nama pemilik rekening wajib diisi').max(120),
}).strict()

export const refundCreateSchema = z.object({ bookingId: z.uuid('Pilih booking'), amount, reason, recipient: refundRecipientSchema.nullish(), forceMajeure: forceMajeureSchema }).strict()

export const refundSettingsSchema = z.object({
  approvalMode: z.enum(['above_policy', 'above_half', 'either'], { error: 'Pilih aturan persetujuan' }),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).strict()

export const refundActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }).strict(),
  z.object({ action: z.literal('reject'), notes: note }).strict(),
  z.object({ action: z.literal('update'), amount, reason, recipient: refundRecipientSchema.nullish(), forceMajeure: forceMajeureSchema }).strict(),
  /** `paidAt` = instan UTC ISO dari `DateTimeField`; `cashAccount` = `bank:<uuid>` | `cash`. */
  z.object({ action: z.literal('pay'), cashAccount: z.string().max(60), paidAt: z.iso.datetime({ error: 'Tanggal bayar tidak valid' }).transform(v => new Date(v)), notes: note, recipient: refundRecipientSchema.nullish() }).strict(),
])
