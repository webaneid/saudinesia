import { Prisma, type BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { lockBooking } from '@/lib/refunds/service'
import { completionSharePotential, planSharePotential } from '@/lib/revenue-share/potential'
import { syncRevenueShare } from '@/lib/revenue-share/entitlement'
import { isDeletedAccount } from '@/lib/customers/query'
import { calendarDateOf, todayInApp, type CalendarDate } from '@/lib/time'

// Tandai selesai / Buka kembali (Fase 13d, docs/arsitektur-bagi-hasil.md §5d). SATU-SATUNYA penulis status `completed`, `Booking.completedAt/completedById`, dan
// `booking_completion_events` (append-only). Syarat dibaca ULANG di dalam kunci booking; potensi bagi hasil akhir DIBEKUKAN di event dan hak disinkronkan di transaksi yang sama.

export type CompletionBlocker = 'not_active' | 'not_confirmed' | 'unpaid' | 'pending_payment' | 'not_returned'

export const COMPLETION_BLOCKER_LABEL: Record<CompletionBlocker, string> = {
  not_active: 'Pesanan tidak aktif',
  not_confirmed: 'Pesanan belum dikonfirmasi',
  unpaid: 'Tagihan belum lunas',
  pending_payment: 'Ada pembayaran yang belum selesai diproses (bukti transfer / VA / QRIS)',
  not_returned: 'Tanggal pulang belum lewat',
}

export type CompletionFacts = {
  status: BookingStatus
  confirmedAt: Date | null
  /** Tagihan dan terbayar (rupiah) dari `billOf`. */
  grandTotal: number
  paid: number
  /** Ada pembayaran `pending` (bukti) atau `awaiting` (gateway). */
  openPayment: boolean
  departureDate: Date | null
  returnDate: Date | null
}

const cents = (x: number): number => Math.round(x * 100)

/** Alasan booking belum bisa ditandai selesai (kosong = bisa). Murni — dipakai server (di dalam kunci) dan tampilan. Tanpa tanggal = tak perlu menunggu. */
export function completionBlockers(f: CompletionFacts, today: CalendarDate = todayInApp()): CompletionBlocker[] {
  if (f.status !== 'active') return ['not_active']
  const out: CompletionBlocker[] = []
  if (!f.confirmedAt) out.push('not_confirmed')
  if (cents(f.paid) < cents(f.grandTotal)) out.push('unpaid')
  if (f.openPayment) out.push('pending_payment')
  const end = f.returnDate ?? f.departureDate
  if (end && calendarDateOf(end) > today) out.push('not_returned')
  return out
}

type Tx = Prisma.TransactionClient

/** Fakta penyelesaian satu booking. Di jalur tulis HARUS dipanggil sesudah `lockBooking`. */
export async function completionFacts(db: Pick<Tx, 'booking'>, bookingId: string): Promise<CompletionFacts | null> {
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      status: true, confirmedAt: true, departureDate: true, returnDate: true, totalAmount: true,
      invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } },
      payments: { where: { status: { in: ['confirmed', 'pending', 'awaiting'] } }, select: { status: true, amount: true } },
      refunds: billRefunds,
    },
  })
  if (!b) return null
  const bill = billOf(b)
  return {
    status: b.status, confirmedAt: b.confirmedAt, grandTotal: bill.grandTotal, paid: bill.paid,
    openPayment: b.payments.some(p => p.status === 'pending' || p.status === 'awaiting'),
    departureDate: b.departureDate, returnDate: b.returnDate,
  }
}

export type CompletionResult =
  | { kind: 'not_found' }
  | { kind: 'blocked'; blockers: CompletionBlocker[] }
  | { kind: 'not_completed' }
  | { kind: 'owner_unavailable' } // akun pemilik dihapus (UU PDP) / nonaktif — booking tak boleh hidup lagi
  | { kind: 'done'; eventId: string; shareDeltaCents: number }

/** Tandai selesai. Peran diperiksa pemanggil (`requireBookingComplete`). */
export async function completeBooking(bookingId: string, byUserId: string): Promise<CompletionResult> {
  return prisma.$transaction(async (tx): Promise<CompletionResult> => {
    if (!await tx.booking.findUnique({ where: { id: bookingId }, select: { id: true } })) return { kind: 'not_found' }
    await lockBooking(tx, bookingId)
    const f = await completionFacts(tx, bookingId)
    if (!f) return { kind: 'not_found' }
    const blockers = completionBlockers(f)
    if (blockers.length > 0) return { kind: 'blocked', blockers }
    const potentialIdr = await completionSharePotential(tx, bookingId)
    await tx.booking.update({ where: { id: bookingId }, data: { status: 'completed', completedAt: new Date(), completedById: byUserId, completedPotentialIdr: potentialIdr } })
    const ev = await tx.bookingCompletionEvent.create({ data: { bookingId, action: 'complete', byUserId, potentialIdr }, select: { id: true } })
    const shareDeltaCents = await syncRevenueShare(tx, bookingId, { source: 'completion', refId: ev.id })
    return { kind: 'done', eventId: ev.id, shareDeltaCents }
  })
}

/** Buka kembali booking selesai → `active`. Hak kembali ke potensi rencana. Peran diperiksa pemanggil (`canReopenBooking`). */
export async function reopenBooking(bookingId: string, byUserId: string): Promise<CompletionResult> {
  return prisma.$transaction(async (tx): Promise<CompletionResult> => {
    if (!await tx.booking.findUnique({ where: { id: bookingId }, select: { id: true } })) return { kind: 'not_found' }
    await lockBooking(tx, bookingId)
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true, userId: true } })
    if (b.status !== 'completed') return { kind: 'not_completed' }
    // Pemilik dibaca di dalam kunci barisnya (pola lib/booking/drafts.ts): booking selesai tak menahan penghapusan akun, jadi membuka kembali booking milik akun
    // terhapus/nonaktif akan menghidupkan jalur yang menerima PII jamaah baru. Penghapusan akun mengunci baris pengguna yang sama → terserialkan.
    const owner = await tx.$queryRaw<Array<{ email: string; isActive: boolean }>>( // Prisma ORM tak punya SELECT … FOR SHARE
      Prisma.sql`SELECT "email", "isActive" FROM "users" WHERE "id" = ${b.userId} FOR SHARE`,
    )
    if (!owner[0] || isDeletedAccount(owner[0].email) || !owner[0].isActive) return { kind: 'owner_unavailable' }
    await tx.booking.update({ where: { id: bookingId }, data: { status: 'active', completedAt: null, completedById: null, completedPotentialIdr: null } })
    const { potentialIdr } = await planSharePotential(tx, bookingId)
    const ev = await tx.bookingCompletionEvent.create({ data: { bookingId, action: 'reopen', byUserId, potentialIdr }, select: { id: true } })
    const shareDeltaCents = await syncRevenueShare(tx, bookingId, { source: 'completion', refId: ev.id })
    return { kind: 'done', eventId: ev.id, shareDeltaCents }
  })
}
