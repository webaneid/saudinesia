import { billOf, billRefunds, billSelect } from '@/lib/invoice/bill'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { cancelBooking, type CancellableBooking } from '@/lib/booking/cancel'
import { DEPARTURE_REMINDER_DAYS, type DepartureReminderType } from '@/lib/notifications/departure'
import { addDays, dbDateOf, endOfDayExclusiveInApp, startOfDayInApp, todayInApp } from '@/lib/time'

// Hangus & pengingat (docs/arsitektur-booking-engine-v2.md §10.1 poin 5). Jatuh tempo TIDAK mengikat (D4): ia hanya batas bayar yang ditampilkan ke jamaah; pembayaran terlambat
// tetap diterima admin. Yang menghanguskan booking: "belum ada uang masuk sama sekali sampai N hari sebelum tanggal berangkat" (setelan `expireDaysBeforeReference`, 0 = mati),
// dan — khusus pesanan checkout pelanggan — "belum ada pembayaran/bukti sampai lewat jatuh tempo" (SEC-221).
// Booking yang sudah ada uang masuk ATAU bukti menunggu verifikasi TIDAK PERNAH disentuh.

export type ExpireResult = { expired: Array<{ id: string; userId: string; code: string }>; skipped: number }

// `awaiting` (Fase 9) BUKAN uang: tak dihitung di sini (batas pesanan checkout SEC-221 tetap berlaku). Hangus hanya menunggu VA/QR yang MASIH HIDUP
// (`liveAwaiting`, batas waktunya dipotong ke saat hangus — lib/payments/gateway.ts `expiryHours`; SEC-256).
const PAYMENT_ACTIVITY = ['pending', 'confirmed'] as const
const liveAwaiting = (now: Date) => ({ status: 'awaiting' as const, payExpiresAt: { gt: now } })

/** Booking hidup yang belum menerima uang sama sekali (tanpa pembayaran `pending`/`confirmed`) — dipakai hangus dan batas pesanan checkout (SEC-221). */
export const UNPAID_ACTIVE = { status: 'active', confirmedAt: null, payments: { none: { status: { in: [...PAYMENT_ACTIVITY] } } } } as const satisfies Prisma.BookingWhereInput

/** Hanguskan booking yang memenuhi syarat pada `now`. Idempoten: yang sudah `expired` tak diambil lagi; tiap booking diproses dalam transaksinya sendiri dan diperiksa ulang di dalam kunci. */
export async function expireOverdueBookings(now: Date = new Date()): Promise<ExpireResult> {
  const { expireDaysBeforeReference: days } = await getInvoiceSettings()
  const result: ExpireResult = { expired: [], skipped: 0 }
  const today = todayInApp(now)
  const reasons = new Map<string, { reason: string; where: Prisma.BookingWhereInput }>()

  // (1) Menjelang berangkat tanpa uang masuk (setelan `expireDaysBeforeReference`, 0 = mati).
  if (days > 0) {
    const where: Prisma.BookingWhereInput = { ...UNPAID_ACTIVE, AND: [{ payments: { none: liveAwaiting(now) } }], departureDate: { not: null, lte: dbDateOf(addDays(today, days)) } } // berangkat ≤ hari ini + N hari
    for (const { id } of await prisma.booking.findMany({ where, select: { id: true }, orderBy: [{ departureDate: 'asc' }, { id: 'asc' }] })) {
      reasons.set(id, { reason: 'Hangus: belum ada pembayaran menjelang tanggal keberangkatan', where })
    }
  }
  // (2) SEC-221 (pemilik 2026-11-15): pesanan CHECKOUT PELANGGAN (invoice diterbitkan sistem, `issuedById` NULL) yang lewat jatuh tempo tanpa pembayaran/bukti
  // sama sekali — hangus sehari sesudah jatuh tempo supaya kuota tak tertahan. Pesanan buatan admin tak terkena (jatuh tempo tetap label, D4).
  const overdue: Prisma.BookingWhereInput = { ...UNPAID_ACTIVE, AND: [{ payments: { none: liveAwaiting(now) } }], invoice: { is: { issuedById: null, dueDate: { lt: dbDateOf(today) } } } }
  for (const { id } of await prisma.booking.findMany({ where: overdue, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })) {
    if (!reasons.has(id)) reasons.set(id, { reason: 'Hangus: belum ada pembayaran sampai lewat jatuh tempo', where: overdue })
  }

  for (const [id, { reason, where }] of reasons) {
    try {
      const done = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
        // Syarat kandidat dinilai ULANG di dalam kunci (jatuh tempo/tanggal bisa berubah lewat revisi admin), lalu status pembayaran.
        if ((await tx.booking.count({ where: { AND: [{ id }, where] } })) === 0) return null
        const booking = await loadForExpiry(tx, id, now)
        if (!booking) return null // berubah sejak daftar kandidat dibaca (dibayar / dikonfirmasi / dibatalkan)
        await cancelBooking(tx, booking, 'expired')
        return { id: booking.id, userId: booking.userId, code: booking.bookingCode }
      })
      if (done) result.expired.push(done)
      else result.skipped++
    } catch (e) {
      result.skipped++
      console.error(`[cron] gagal menghanguskan booking ${id}:`, e instanceof Error ? e.message : String(e))
    }
  }
  return result
}

async function loadForExpiry(tx: Prisma.TransactionClient, id: string, now: Date): Promise<CancellableBooking | null> {
  const booking = await tx.booking.findUnique({
    where: { id },
    include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true },
  })
  if (!booking || booking.status !== 'active' || booking.confirmedAt !== null) return null
  const activity = await tx.payment.count({ where: { bookingId: id, status: { in: [...PAYMENT_ACTIVITY] } } })
  if (activity > 0) return null
  if (await tx.payment.count({ where: { bookingId: id, ...liveAwaiting(now) } }) > 0) return null
  await tx.payment.updateMany({ where: { bookingId: id, status: 'awaiting' }, data: { status: 'expired' } }) // VA/QR yang sudah lewat batas waktu ikut ditutup
  return booking
}

export type ReminderKind = 'd1' | 'd0'
export type DueReminder = { id: string; userId: string; code: string; deadline: Date; kind: ReminderKind; balance: number; partial: boolean }

/**
 * Booking yang perlu diingatkan hari ini (zona aplikasi): `d0` = jatuh tempo hari ini, `d1` = jatuh tempo besok. Booking `active` yang MASIH BERSISA (Fase 7a F4: termasuk
 * yang kursinya sudah terkonfirmasi lewat DP), tanpa bukti yang sedang menunggu (bukti sudah diunggah = tak perlu diingatkan). `paymentDeadline` = akhir hari jatuh tempo.
 * `partial` = sudah ada pembayaran terverifikasi (pesan menyebut sisa, bukan "belum kami terima").
 */
export async function dueReminders(now: Date = new Date()): Promise<DueReminder[]> {
  const today = todayInApp(now)
  const from = startOfDayInApp(today)
  const to = endOfDayExclusiveInApp(addDays(today, 1)) // sampai akhir BESOK
  const rows = await prisma.booking.findMany({
    where: { status: 'active', paymentDeadline: { gte: from, lt: to }, payments: { none: { status: 'pending' } } },
    select: {
      id: true, userId: true, bookingCode: true, paymentDeadline: true, ...billSelect,
      payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } },
      refunds: billRefunds,
    },
    orderBy: [{ paymentDeadline: 'asc' }, { id: 'asc' }],
  })
  const dayEnd = endOfDayExclusiveInApp(today).getTime()
  return rows.flatMap(r => {
    const bill = billOf(r)
    if (!r.paymentDeadline || bill.balance <= 0) return []
    return [{ id: r.id, userId: r.userId, code: r.bookingCode, deadline: r.paymentDeadline, kind: (r.paymentDeadline.getTime() < dayEnd ? 'd0' : 'd1') as ReminderKind, balance: bill.balance, partial: bill.paid > 0 }]
  })
}

export type DepartureReminder = { id: string; userId: string; code: string; departureDate: Date; type: DepartureReminderType }

/**
 * Pengingat keberangkatan hari ini (docs/arsitektur-notifikasi.md §13): booking `active` dengan kursi TERKONFIRMASI (K2 — yang belum bayar sudah diingatkan bayar dan
 * akan hangus) yang tanggal acuannya (`departureDate`, tanggal kalender turunan item paling awal) = hari ini (zona aplikasi) + 7 atau + 1 hari (K1).
 * Dedupe per tipe di `notify`, jadi H-7 dan H-1 masing-masing sekali per kanal.
 */
export async function departureReminders(now: Date = new Date()): Promise<DepartureReminder[]> {
  const today = todayInApp(now)
  const out: DepartureReminder[] = []
  for (const [type, days] of Object.entries(DEPARTURE_REMINDER_DAYS) as Array<[DepartureReminderType, number]>) {
    const rows = await prisma.booking.findMany({
      where: { status: 'active', confirmedAt: { not: null }, departureDate: dbDateOf(addDays(today, days)) },
      select: { id: true, userId: true, bookingCode: true, departureDate: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    for (const r of rows) if (r.departureDate) out.push({ id: r.id, userId: r.userId, code: r.bookingCode, departureDate: r.departureDate, type })
  }
  return out
}
