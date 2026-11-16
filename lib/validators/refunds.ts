import { z } from 'zod'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'

// Pembatalan admin + refund (Fase 7b-2a, docs/arsitektur-booking-engine-v2.md §10.10). `.strict()`; batas jumlah yang bergantung pada uang masuk dinilai di dalam kunci
// (lib/refunds/service.ts, lib/booking/adminCancel.ts), bukan di sini.
const amount = z.number().int('Jumlah dalam rupiah bulat').positive('Jumlah harus lebih dari 0').max(MAX_PRICE_IDR, 'Jumlah melebihi batas wajar')
const reason = z.string().trim().min(3, 'Alasan wajib diisi (minimal 3 karakter)').max(500)
const note = z.string().trim().max(500).nullish()

export const adminCancelSchema = z.object({
  reason,
  decision: z.enum(['refund', 'retain', 'defer']).nullish(),
  refundAmount: amount.nullish(),
  note,
}).strict()

export const cancelDecisionSchema = z.object({ decision: z.enum(['refund', 'retain']), refundAmount: amount.nullish(), note }).strict()

export const refundProposeSchema = z.object({ amount, reason }).strict()

export const refundActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }).strict(),
  z.object({ action: z.literal('reject'), notes: note }).strict(),
  z.object({ action: z.literal('update'), amount, reason }).strict(),
  /** `paidAt` = instan UTC ISO dari `DateTimeField`; `cashAccount` = `bank:<uuid>` | `cash`. */
  z.object({ action: z.literal('pay'), cashAccount: z.string().max(60), paidAt: z.iso.datetime({ error: 'Tanggal bayar tidak valid' }).transform(v => new Date(v)), notes: note }).strict(),
])
