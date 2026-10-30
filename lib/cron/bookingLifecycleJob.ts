import cron from 'node-cron'
import { notify } from '@/lib/notifications/notify'
import { formatDeadline } from '@/lib/notifications/events'
import { dueReminders, expireOverdueBookings } from '@/lib/booking/expire'
import { getAppTimezone } from '@/lib/time'

// Siklus hidup booking v2 (docs/arsitektur-booking-engine-v2.md §10.1). Jadwal mengikuti zona waktu APLIKASI (Pengaturan Invoice), bukan zona proses.
// Dua pekerjaan harian: hanguskan booking tanpa uang masuk menjelang berangkat, dan ingatkan batas bayar (H-1 dan hari-H). Pengingat TIDAK membatalkan apa pun.

export async function runExpireJob(now: Date = new Date()): Promise<void> {
  const { expired } = await expireOverdueBookings(now)
  for (const b of expired) {
    try {
      await notify({ userId: b.userId, bookingId: b.id, event: { type: 'booking_expired', code: b.code }, dedupe: true })
      console.log(`[cron] Booking hangus: ${b.code}`)
    } catch (err) {
      console.error(`[cron] Gagal memberi tahu booking hangus ${b.code}:`, err)
    }
  }
}

export async function runReminderJob(now: Date = new Date()): Promise<void> {
  for (const r of await dueReminders(now)) {
    // Dedupe PER KANAL di dalam notify (hanya yang berstatus 'sent'): pengingat yang gagal/dilewati dicoba lagi di siklus berikutnya.
    const type = r.kind === 'd0' ? 'payment_reminder_d0' as const : 'payment_reminder_d1' as const
    const outcomes = await notify({ userId: r.userId, bookingId: r.id, event: { type, code: r.code, deadline: formatDeadline(r.deadline) }, dedupe: true })
    console.log(`[cron] ${type} ${r.code}: ${outcomes.map(o => `${o.channel}=${o.status}`).join(' ') || 'tidak ada kanal'}`)
  }
}

export function startBookingLifecycleJobs(): void {
  const timezone = getAppTimezone()
  cron.schedule('20 0 * * *', () => { runExpireJob().catch(err => console.error('[cron] expire job:', err)) }, { timezone })
  cron.schedule('0 8 * * *', () => { runReminderJob().catch(err => console.error('[cron] reminder job:', err)) }, { timezone })
  console.log(`[cron] Booking lifecycle jobs scheduled (hangus 00:20, pengingat 08:00 — ${timezone})`)
}
