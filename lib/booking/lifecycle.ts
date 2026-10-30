import type { BookingStatus, Prisma } from '@prisma/client'
import { addDays, calendarDateOf, dbDateOf, endOfDayExclusiveInApp, todayInApp, type CalendarDate } from '@/lib/time'

// Siklus hidup booking v2 (docs/arsitektur-booking-engine-v2.md §3.2/§10.1, Fase 3). Kolom `status` hanya menyimpan SIKLUS HIDUP (draft · active · completed · cancelled · expired);
// "menunggu pembayaran / bukti diverifikasi / dikonfirmasi / dalam perjalanan" adalah TURUNAN yang dihitung di sini dari pembayaran, `confirmedAt`, dan tanggal — satu tempat, tak ada salinan.

export type DisplayStatus = 'draft' | 'awaiting_payment' | 'payment_review' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'expired'

export type StatusFacts = {
  status: BookingStatus
  confirmedAt: Date | null
  /** Ada pembayaran `pending` (bukti diunggah, menunggu verifikasi admin). */
  hasPendingPayment: boolean
  departureDate: Date | null
  returnDate: Date | null
}

/** Status tampilan. `today` = tanggal kalender zona aplikasi (bawaan: hari ini). Dalam perjalanan = dikonfirmasi dan hari ini di antara tanggal berangkat–pulang. */
export function displayStatus(f: StatusFacts, today: CalendarDate = todayInApp()): DisplayStatus {
  if (f.status !== 'active') return f.status
  if (f.confirmedAt) {
    if (f.departureDate && f.returnDate && calendarDateOf(f.departureDate) <= today && today <= calendarDateOf(f.returnDate)) return 'in_progress'
    return 'confirmed'
  }
  return f.hasPendingPayment ? 'payment_review' : 'awaiting_payment'
}

/** Kolom yang dibutuhkan `displayStatusOf` — sertakan di `select` setiap daftar/detail booking (satu `pending` cukup, jadi `take: 1`). */
export const statusSelect = {
  status: true, confirmedAt: true, departureDate: true, returnDate: true,
  payments: { where: { status: 'pending' }, select: { id: true }, take: 1 },
} as const satisfies Prisma.BookingSelect

type StatusRow = { status: BookingStatus; confirmedAt: Date | null; departureDate: Date | null; returnDate: Date | null; payments: Array<{ id: string }> }
export const displayStatusOf = (row: StatusRow, today?: CalendarDate): DisplayStatus =>
  displayStatus({ status: row.status, confirmedAt: row.confirmedAt, hasPendingPayment: row.payments.length > 0, departureDate: row.departureDate, returnDate: row.returnDate }, today)

/** Batas bayar yang ditampilkan ke jamaah: AKHIR hari jatuh tempo (zona aplikasi), `dueDays` hari sejak hari ini. Hanya label — tidak mengikat (D4). */
export const paymentDeadlineFor = (now: Date, dueDays: number): Date => new Date(endOfDayExclusiveInApp(addDays(todayInApp(now), dueDays)).getTime() - 1)

/** Jamaah boleh membatalkan sendiri hanya selama booking hidup dan BELUM dikonfirmasi (perilaku v1; refund/kebijakan lain menyusul Fase 7). */
export const isPilgrimCancellable = (f: Pick<StatusFacts, 'status' | 'confirmedAt'>): boolean => f.status === 'active' && f.confirmedAt === null

/** Booking yang masih dapat menerima/diproses pembayarannya. */
export const isOpenForPayment = (status: BookingStatus): boolean => status === 'active'

export type PaymentState = 'unpaid' | 'partial' | 'paid' | 'overpaid'
const cents = (n: number): number => Math.round(n * 100)
/** Keadaan bayar dari tagihan vs jumlah terverifikasi (dibulatkan sen; kode unik/biaya layanan tidak termasuk). */
export function paymentState(total: number, paid: number): PaymentState {
  const t = cents(total); const p = cents(paid)
  if (p <= 0) return 'unpaid'
  if (p < t) return 'partial'
  return p === t ? 'paid' : 'overpaid'
}

/** Lewat jatuh tempo dan masih ada sisa. Jatuh tempo tidak mengikat — hanya label (D4). */
export function isOverdue(f: { status: BookingStatus; paymentDeadline: Date | null }, total: number, paid: number, now: Date = new Date()): boolean {
  return f.status === 'active' && f.paymentDeadline !== null && now.getTime() > f.paymentDeadline.getTime() && cents(paid) < cents(total)
}

/**
 * Fragmen `where` per filter tampilan — dipakai daftar admin, dasbor, dan halaman pembayaran supaya definisi "menunggu bayar" dsb. HANYA ada di sini.
 * (`in_progress` bukan filter: ia sebagian dari `confirmed`.)
 */
export const bookingWhere = {
  draft: { status: 'draft' },
  awaiting_payment: { status: 'active', confirmedAt: null, payments: { none: { status: 'pending' } } },
  payment_review: { status: 'active', confirmedAt: null, payments: { some: { status: 'pending' } } },
  confirmed: { status: 'active', confirmedAt: { not: null } },
  completed: { status: 'completed' },
  cancelled: { status: 'cancelled' },
  expired: { status: 'expired' },
} as const satisfies Record<string, Prisma.BookingWhereInput>

export type StatusFilter = keyof typeof bookingWhere | 'in_progress'
export const STATUS_FILTERS: readonly StatusFilter[] = ['draft', 'awaiting_payment', 'payment_review', 'confirmed', 'in_progress', 'completed', 'cancelled', 'expired']
export const isStatusFilter = (v: unknown): v is StatusFilter => typeof v === 'string' && (STATUS_FILTERS as readonly string[]).includes(v)

/**
 * `where` untuk filter status TAMPILAN pada `today`. `confirmed` = dikonfirmasi dan BELUM berjalan; `in_progress` = dikonfirmasi dan hari ini di antara berangkat–pulang —
 * keduanya saling lepas dan sama dengan `displayStatus` (tanggal kosong dihitung eksplisit; `NOT(a AND b)` SQL akan membuang baris bertanggal NULL).
 */
export function statusWhere(filter: StatusFilter, today: CalendarDate = todayInApp()): Prisma.BookingWhereInput {
  const t = dbDateOf(today)
  if (filter === 'in_progress') return { ...bookingWhere.confirmed, departureDate: { lte: t }, returnDate: { gte: t } }
  if (filter === 'confirmed') return { ...bookingWhere.confirmed, OR: [{ departureDate: null }, { returnDate: null }, { departureDate: { gt: t } }, { returnDate: { lt: t } }] }
  return bookingWhere[filter]
}
