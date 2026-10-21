import cron from 'node-cron'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notifications/notify'
import { formatDeadline } from '@/lib/notifications/events'
import { cancelBooking } from '@/lib/booking/cancel'

const HOUR_MS = 60 * 60 * 1000

export function startAutoCancelJob(): void {
  cron.schedule('0 * * * *', async () => {
    const expired = await prisma.booking.findMany({
      where: { status: 'awaiting_payment', paymentDeadline: { lt: new Date() } },
      include: {
        user: true,
        hotels: true,
        transports: true,
        muthowif: true,
        tourPackages: true,
        haji: true,
      },
    })

    for (const booking of expired) {
      try {
        // docs/arsitektur-booking.md §6 Step 3 — fungsi yang SAMA persis dipakai self-cancel
        // (DELETE /api/v1/bookings/[id]), tidak lagi dua implementasi tulis-tangan terpisah yang
        // bisa divergen (menutup Gap #2/#3 sekaligus di jalur cron ini juga).
        await prisma.$transaction(tx => cancelBooking(tx, booking, 'Auto-cancel: batas waktu pembayaran terlewat'))

        await notify({ userId: booking.userId, bookingId: booking.id, event: { type: 'auto_cancelled', code: booking.bookingCode }, dedupe: true })

        console.log(`[cron] Auto-cancelled: ${booking.bookingCode}`)
      } catch (err) {
        console.error(`[cron] Failed to cancel ${booking.bookingCode}:`, err)
      }
    }
  })

  console.log('[cron] Auto-cancel job scheduled (every hour)')
}

export function startPaymentReminderJob(): void {
  // Runs at :30 every hour — catches bookings with ~12h or ~2h left before deadline
  cron.schedule('30 * * * *', async () => {
    const now = new Date()
    const r12Start = new Date(now.getTime() + 11 * HOUR_MS)
    const r12End   = new Date(now.getTime() + 13 * HOUR_MS)
    const r2Start  = new Date(now.getTime() +  1 * HOUR_MS)
    const r2End    = new Date(now.getTime() +  3 * HOUR_MS)

    const bookings = await prisma.booking.findMany({
      where: {
        status: 'awaiting_payment',
        paymentDeadline: { not: null, gte: r2Start, lte: r12End },
      },
      include: { user: true },
    })

    for (const booking of bookings) {
      if (!booking.paymentDeadline) continue

      const hoursLeft = (booking.paymentDeadline.getTime() - now.getTime()) / HOUR_MS
      const type =
        hoursLeft >= 11 && hoursLeft <= 13 ? 'payment_reminder_12h' as const :
        hoursLeft >=  1 && hoursLeft <=  3 ? 'payment_reminder_22h' as const :
        null

      if (!type) continue

      // Dedupe PER KANAL di dalam notify (hanya yang berstatus 'sent'): pengingat yang gagal/dilewati dicoba lagi di siklus
      // berikutnya. Dulu dedupe memakai log yang selalu 'sent' sehingga pengingat gagal tidak pernah diulang, dan user
      // tanpa nomor telepon dilewati total (kini tetap dapat email).
      const outcomes = await notify({
        userId: booking.userId,
        bookingId: booking.id,
        event: { type, code: booking.bookingCode, deadline: formatDeadline(booking.paymentDeadline) },
        dedupe: true,
      })
      console.log(`[cron] ${type} ${booking.bookingCode}: ${outcomes.map(o => `${o.channel}=${o.status}`).join(' ') || 'tidak ada kanal'}`)
    }
  })

  console.log('[cron] Payment reminder job scheduled (every :30)')
}
