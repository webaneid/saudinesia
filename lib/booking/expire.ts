import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { cancelBooking, type CancellableBooking } from '@/lib/booking/cancel'
import { addDays, dbDateOf, endOfDayExclusiveInApp, startOfDayInApp, todayInApp } from '@/lib/time'

// Hangus & pengingat (docs/arsitektur-booking-engine-v2.md §10.1 poin 5). Jatuh tempo TIDAK mengikat (D4): ia hanya batas bayar yang ditampilkan ke jamaah; pembayaran terlambat
// tetap diterima admin. Satu-satunya yang menghanguskan booking adalah "belum ada uang masuk sama sekali sampai N hari sebelum tanggal berangkat" (setelan `expireDaysBeforeReference`, 0 = mati).
// Booking yang sudah ada uang masuk ATAU bukti menunggu verifikasi TIDAK PERNAH disentuh.

export type ExpireResult = { expired: Array<{ id: string; userId: string; code: string }>; skipped: number }

const PAYMENT_ACTIVITY = ['pending', 'confirmed'] as const

/** Hanguskan booking yang memenuhi syarat pada `now`. Idempoten: yang sudah `expired` tak diambil lagi; tiap booking diproses dalam transaksinya sendiri dan diperiksa ulang di dalam kunci. */
export async function expireOverdueBookings(now: Date = new Date()): Promise<ExpireResult> {
  const { expireDaysBeforeReference: days } = await getInvoiceSettings()
  const result: ExpireResult = { expired: [], skipped: 0 }
  if (days <= 0) return result

  const cutoff = dbDateOf(addDays(todayInApp(now), days)) // tanggal berangkat ≤ hari ini + N hari → sudah terlalu dekat tanpa uang masuk
  const candidates = await prisma.booking.findMany({
    where: { status: 'active', confirmedAt: null, departureDate: { not: null, lte: cutoff }, payments: { none: { status: { in: [...PAYMENT_ACTIVITY] } } } },
    select: { id: true },
    orderBy: [{ departureDate: 'asc' }, { id: 'asc' }],
  })

  for (const { id } of candidates) {
    try {
      const done = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
        const booking = await loadForExpiry(tx, id)
        if (!booking) return null // berubah sejak daftar kandidat dibaca (dibayar / dikonfirmasi / dibatalkan)
        await cancelBooking(tx, booking, 'Hangus: belum ada pembayaran menjelang tanggal keberangkatan', 'expired')
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

async function loadForExpiry(tx: Prisma.TransactionClient, id: string): Promise<CancellableBooking | null> {
  const booking = await tx.booking.findUnique({
    where: { id },
    include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, flights: true, packages: true },
  })
  if (!booking || booking.status !== 'active' || booking.confirmedAt !== null) return null
  const activity = await tx.payment.count({ where: { bookingId: id, status: { in: [...PAYMENT_ACTIVITY] } } })
  if (activity > 0) return null
  return booking
}

export type ReminderKind = 'd1' | 'd0'
export type DueReminder = { id: string; userId: string; code: string; deadline: Date; kind: ReminderKind }

/**
 * Booking yang perlu diingatkan hari ini (zona aplikasi): `d0` = jatuh tempo hari ini, `d1` = jatuh tempo besok. Hanya `active` yang belum dikonfirmasi, tanpa bukti yang sedang menunggu
 * (bukti sudah diunggah = tak perlu diingatkan). `paymentDeadline` = akhir hari jatuh tempo, jadi "hari jatuh tempo" = hari kalender tempat ia jatuh.
 */
export async function dueReminders(now: Date = new Date()): Promise<DueReminder[]> {
  const today = todayInApp(now)
  const from = startOfDayInApp(today)
  const to = endOfDayExclusiveInApp(addDays(today, 1)) // sampai akhir BESOK
  const rows = await prisma.booking.findMany({
    where: { status: 'active', confirmedAt: null, paymentDeadline: { gte: from, lt: to }, payments: { none: { status: 'pending' } } },
    select: { id: true, userId: true, bookingCode: true, paymentDeadline: true },
    orderBy: [{ paymentDeadline: 'asc' }, { id: 'asc' }],
  })
  const dayEnd = endOfDayExclusiveInApp(today).getTime()
  return rows.flatMap(r => r.paymentDeadline ? [{ id: r.id, userId: r.userId, code: r.bookingCode, deadline: r.paymentDeadline, kind: (r.paymentDeadline.getTime() < dayEnd ? 'd0' : 'd1') as ReminderKind }] : [])
}
