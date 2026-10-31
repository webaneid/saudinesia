import { Prisma } from '@prisma/client'
import { retaxInvoice } from '@/lib/invoice/issue'
import { prisma } from '@/lib/db'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'
import { bookingPriceSummary, bookingSnapshotTotals, writeAdjustmentLine } from '@/lib/pricing/engine/snapshot'
import { evaluatePricing, type PricingEvaluation } from '@/lib/pricing/warnings'

// Diskon / biaya tambahan di TOTAL pesanan (docs/arsitektur-harga-terpadu.md §20, 7B). SATU-SATUNYA penulis `booking_adjustments`. Per perubahan, dalam SATU transaksi yang mengunci baris
// booking: baris penyesuaian + SATU baris snapshot `penyesuaian` + `Booking.totalAmount` baru (invarian I4: total = Σ snapshot). Tak ada UPDATE/DELETE snapshot — membatalkan = baris pembalik.
// Hanya saat `awaiting_payment` (belum ada pembayaran berjumlah tetap); di luar itu jalurnya refund, bukan fase ini.
// Fase 8 (§21): total boleh berapa pun (> 0) — di bawah rekomendasi atau di bawah HPP hanya menghasilkan PERINGATAN internal di hasilnya, tak pernah penolakan; catatan alasan opsional.

export class AdjustmentError extends Error {
  constructor(public readonly status: 400 | 404 | 409 | 422, message: string) { super(message); this.name = 'AdjustmentError' }
}
export const MAX_LABEL_LENGTH = 120
export const MAX_REASON_LENGTH = 500

const round2 = (x: number): number => Math.round(x * 100) / 100

export type AdjustInput = { bookingId: string; amountIdr: number; label: string; reason?: string | null; byUserId: string }
export type AdjustResult = {
  adjustmentId: string; totalBefore: number; totalAfter: number; belowCost: boolean; costKnownIdr: number
  /** Peringatan INTERNAL (tak pernah ke jamaah/invoice) atas harga sebelum dan sesudah perubahan — hanya mengingatkan. */
  warningBefore: PricingEvaluation; warningAfter: PricingEvaluation
}

type ApplyInput = Omit<AdjustInput, 'amountIdr' | 'label'> & { amountIdr?: number; targetTotalIdr?: number; label?: string; reversesId?: string; fallbackReason?: string }

async function apply(input: ApplyInput): Promise<AdjustResult> {
  const reasonText = input.reason?.trim() || null
  if (reasonText && reasonText.length > MAX_REASON_LENGTH) throw new AdjustmentError(400, `Catatan maksimal ${MAX_REASON_LENGTH} karakter`)
  if (input.label !== undefined && (input.label.trim().length < 1 || input.label.trim().length > MAX_LABEL_LENGTH)) throw new AdjustmentError(400, `Label wajib diisi (maksimal ${MAX_LABEL_LENGTH} karakter) — ini tampil di invoice`)
  if (input.targetTotalIdr !== undefined && !(Number.isFinite(input.targetTotalIdr) && input.targetTotalIdr > 0)) throw new AdjustmentError(422, 'Total harga jual harus lebih dari 0 — batalkan pesanan bila memang tak berbayar')
  if (input.amountIdr !== undefined && (!Number.isFinite(input.amountIdr) || input.amountIdr === 0 || Math.abs(input.amountIdr) > MAX_PRICE_IDR)) throw new AdjustmentError(400, 'Jumlah penyesuaian tidak valid (tidak boleh 0 atau melebihi batas wajar)')

  return prisma.$transaction(async tx => {
    // Kunci baris booking: dua penyesuaian paralel tak boleh sama-sama membaca total lama.
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${input.bookingId} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
    if (locked.length === 0) throw new AdjustmentError(404, 'Pesanan tidak ditemukan')
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId }, select: { status: true, totalAmount: true, confirmedAt: true, payments: { where: { status: 'pending' }, select: { id: true }, take: 1 } } })
    if (booking.status !== 'active' || booking.confirmedAt !== null || booking.payments.length > 0) throw new AdjustmentError(409, 'Total hanya dapat disesuaikan saat pesanan menunggu pembayaran. Setelah dibayar, gunakan jalur refund.')

    const before = await bookingSnapshotTotals(tx, input.bookingId)
    const totalBefore = round2(Number(booking.totalAmount))
    if (round2(before.sellIdr) !== totalBefore) throw new AdjustmentError(409, 'Total pesanan tidak sama dengan jumlah rincian harga — hubungi pengembang sebelum menyesuaikan')

    // "Atur total" = selisih terhadap total TERKINI yang dibaca di dalam kunci (bukan total yang dilihat admin saat membuka halaman).
    const amount = input.targetTotalIdr !== undefined ? round2(round2(input.targetTotalIdr) - totalBefore) : round2(input.amountIdr!)
    if (amount === 0) throw new AdjustmentError(400, input.targetTotalIdr !== undefined ? 'Total harga jual sudah sama — tidak ada yang diubah' : 'Jumlah penyesuaian tidak valid')
    if (!Number.isFinite(amount)) throw new AdjustmentError(400, 'Total tidak valid')
    const label = (input.label?.trim()) || (amount < 0 ? 'Diskon' : 'Biaya tambahan')

    const totalAfter = round2(totalBefore + amount)
    if (!(totalAfter > 0)) throw new AdjustmentError(422, 'Total akhir harus lebih dari 0 — batalkan pesanan bila memang tak berbayar')
    // Batas atas total (sama dengan batas jumlah pembayaran, lib/payments/confirmAmount.ts): total di atasnya tak dapat dikonfirmasi. Menurunkan total tetap boleh walau pesanan sudah di atas batas.
    if (totalAfter > MAX_PRICE_IDR && totalAfter > totalBefore) throw new AdjustmentError(400, `Total melebihi batas wajar (${MAX_PRICE_IDR.toLocaleString('id-ID')}) — periksa kembali angkanya`)
    const costKnown = round2(before.costKnownIdr)
    const belowCost = totalAfter < costKnown // dicatat untuk audit/laporan rugi — BUKAN syarat apa pun
    const reason = reasonText ?? input.fallbackReason ?? null
    const warningBefore = evaluatePricing(await bookingPriceSummary(tx, input.bookingId))

    const row = await tx.bookingAdjustment.create({
      data: {
        bookingId: input.bookingId, amountIdr: amount, label, reason, totalBefore, totalAfter, costKnownIdr: costKnown, belowCost,
        reversesId: input.reversesId ?? null, byUserId: input.byUserId,
      },
    })
    await writeAdjustmentLine(tx, { bookingId: input.bookingId, adjustmentId: row.id, label, amountIdr: amount })
    await tx.booking.update({ where: { id: input.bookingId }, data: { totalAmount: totalAfter } })
    // Pajak invoice ikut dasar yang baru (tarif beku saat terbit) — tanpa ini tagihan = subtotal baru + pajak lama.
    await retaxInvoice(tx, input.bookingId)

    const afterSummary = await bookingPriceSummary(tx, input.bookingId)
    if (round2(afterSummary.sellIdr) !== totalAfter) throw new Error('Invarian total = Σ snapshot dilanggar setelah penyesuaian') // rollback utuh
    return { adjustmentId: row.id, totalBefore, totalAfter, belowCost, costKnownIdr: costKnown, warningBefore, warningAfter: evaluatePricing(afterSummary) }
  })
}

/** Tambah diskon (negatif) / biaya tambahan (positif) pada total pesanan. */
export function adjustBookingTotal(input: AdjustInput): Promise<AdjustResult> {
  return apply(input)
}

/**
 * Atur TOTAL harga jual pesanan langsung (nego/diskon): selisih terhadap total terkini dihitung di dalam kunci lalu memakai jalur yang sama (satu baris penyesuaian + satu baris snapshot + totalAmount).
 * "Edit" = atur total lagi (baris baru, riwayat utuh). Tidak pernah menolak karena harga rendah — hanya mengembalikan peringatan; yang ditolak hanya total ≤ 0 dan status selain menunggu pembayaran.
 */
export function setBookingTotal(input: { bookingId: string; totalIdr: number; label?: string | null; reason?: string | null; byUserId: string }): Promise<AdjustResult> {
  return apply({ bookingId: input.bookingId, targetTotalIdr: input.totalIdr, label: input.label?.trim() || undefined, reason: input.reason, byUserId: input.byUserId })
}

/**
 * Ubah HANYA catatan alasan (internal) satu penyesuaian. Label/jumlah beku di snapshot dan invoice — mengubahnya = batalkan lalu buat baru. Boleh kapan saja (tak menyentuh angka).
 * Setiap perubahan NYATA mencatat siapa dan kapan (`reasonEditedByUserId`/`reasonEditedAt`, SEC-101); mengirim catatan yang sama tidak mengubah apa pun (jejak tak tergeser).
 */
export async function updateAdjustmentReason(input: { bookingId: string; adjustmentId: string; reason: string | null | undefined; byUserId: string }): Promise<{ id: string; reason: string | null; changed: boolean }> {
  const reason = input.reason?.trim() || null
  if (reason && reason.length > MAX_REASON_LENGTH) throw new AdjustmentError(400, `Catatan maksimal ${MAX_REASON_LENGTH} karakter`)
  return prisma.$transaction(async tx => {
    // Kunci baris: dua edit paralel tak boleh sama-sama menganggap "berubah" lalu saling menimpa jejak.
    const rows = await tx.$queryRaw<Array<{ reason: string | null }>>(Prisma.sql`SELECT "reason" FROM "booking_adjustments" WHERE "id" = ${input.adjustmentId} AND "bookingId" = ${input.bookingId} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
    if (rows.length === 0) throw new AdjustmentError(404, 'Penyesuaian tidak ditemukan')
    if ((rows[0]!.reason ?? null) === reason) return { id: input.adjustmentId, reason, changed: false }
    await tx.bookingAdjustment.update({ where: { id: input.adjustmentId }, data: { reason, reasonEditedByUserId: input.byUserId, reasonEditedAt: new Date() } })
    return { id: input.adjustmentId, reason, changed: true }
  })
}

/** Batalkan satu penyesuaian dengan baris pembalik (jumlah berlawanan). Satu penyesuaian hanya dapat dibatalkan sekali; pembatalan tak dapat dibatalkan lagi. */
export async function reverseAdjustment(input: { bookingId: string; adjustmentId: string; reason?: string | null; byUserId: string }): Promise<AdjustResult> {
  const original = await prisma.bookingAdjustment.findUnique({ where: { id: input.adjustmentId }, include: { reversedBy: { select: { id: true } } } })
  if (!original || original.bookingId !== input.bookingId) throw new AdjustmentError(404, 'Penyesuaian tidak ditemukan')
  if (original.reversesId) throw new AdjustmentError(409, 'Baris pembatalan tidak dapat dibatalkan lagi — buat penyesuaian baru')
  if (original.reversedBy) throw new AdjustmentError(409, 'Penyesuaian ini sudah dibatalkan')
  try {
    return await apply({
      bookingId: input.bookingId, amountIdr: -Number(original.amountIdr), label: `Pembatalan: ${original.label}`.slice(0, MAX_LABEL_LENGTH),
      reason: input.reason?.trim() || null, fallbackReason: `Pembatalan penyesuaian ${original.id.slice(0, 8)}`, byUserId: input.byUserId, reversesId: original.id,
    })
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') throw new AdjustmentError(409, 'Penyesuaian ini sudah dibatalkan') // balapan: unik reversesId
    throw e
  }
}

export type AdjustmentView = {
  id: string; amountIdr: number; label: string; reason: string | null; totalBefore: number; totalAfter: number; belowCost: boolean
  reversesId: string | null; reversed: boolean; byUserId: string; byName: string | null; createdAt: string
  /** Edit catatan terakhir (SEC-101); null = tak pernah diedit. */
  reasonEditedByName: string | null; reasonEditedAt: string | null
}

/** Riwayat penyesuaian satu pesanan (terbaru dulu) — INTERNAL admin (memuat `reason`). */
export async function listAdjustments(bookingId: string): Promise<AdjustmentView[]> {
  const rows = await prisma.bookingAdjustment.findMany({ where: { bookingId }, include: { reversedBy: { select: { id: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] })
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap(r => (r.reasonEditedByUserId ? [r.byUserId, r.reasonEditedByUserId] : [r.byUserId])))] } }, select: { id: true, fullName: true } })
  const names = new Map(users.map(u => [u.id, u.fullName]))
  return rows.map(r => ({
    id: r.id, amountIdr: Number(r.amountIdr), label: r.label, reason: r.reason, totalBefore: Number(r.totalBefore), totalAfter: Number(r.totalAfter), belowCost: r.belowCost,
    reversesId: r.reversesId, reversed: r.reversedBy !== null, byUserId: r.byUserId, byName: names.get(r.byUserId) ?? null, createdAt: r.createdAt.toISOString(),
    reasonEditedByName: r.reasonEditedByUserId ? (names.get(r.reasonEditedByUserId) ?? 'staf') : null, reasonEditedAt: r.reasonEditedAt ? r.reasonEditedAt.toISOString() : null,
  }))
}
