import { prisma } from '@/lib/db'
import { notify, type ChannelOutcome } from '@/lib/notifications/notify'
import { formatDeadline, type NotificationType } from '@/lib/notifications/events'
import { type DepartureReminderType } from '@/lib/notifications/departure'
import { sendInvoiceNotification } from '@/lib/invoice/notifyInvoice'
import { billOf, billRefunds, billSelect } from '@/lib/invoice/bill'
import { DATE_LONG, calendarDateOf, daysBetween, formatCalendarDate, todayInApp } from '@/lib/time'

// Kirim ulang dari log notifikasi (docs/arsitektur-notifikasi.md §14). Log TIDAK menyimpan isi kejadian, jadi pesan DISUSUN ULANG dari data booking TERKINI
// (N1: hanya jenis yang bisa disusun dengan benar — invoice, pengingat bayar, pembayaran diterima, pengingat berangkat). Lewat `notify()` tanpa dedupe:
// email + WhatsApp seperti notifikasi biasa (N2), aturan kanal tetap (WA hanya nomor terverifikasi + persetujuan + batas harian). Satu-satunya penyusun ulang.

export const RESENDABLE_TYPES = [
  'invoice_issued', 'payment_reminder_d1', 'payment_reminder_d0', 'payment_confirmed', 'departure_reminder_7d', 'departure_reminder_1d',
] as const satisfies readonly NotificationType[]
export type ResendableType = (typeof RESENDABLE_TYPES)[number]

export const isResendable = (type: string): type is ResendableType => (RESENDABLE_TYPES as readonly string[]).includes(type)

/** Alasan menolak — dipetakan ke HTTP oleh route. `not_applicable` = keadaan booking sekarang membuat pesan itu salah (lunas, sudah berangkat, …). */
export type ResendRefusal = 'not_found' | 'not_resendable' | 'no_booking' | 'inactive' | 'not_applicable'
export type ResendResult = { ok: true; bookingId: string; channels: ChannelOutcome[] } | { ok: false; reason: ResendRefusal }

/** Baris log yang boleh dikirim ulang: jenis didukung DAN terkait booking. Dipakai UI (tombol) dan `resendNotification` (penolakan). */
export function canResendLog(log: { type: string; bookingId: string | null }): boolean {
  return isResendable(log.type) && log.bookingId !== null
}

/** Pemeriksaan murah sebelum batas laju: baris ada, jenis didukung, terkait booking. */
export async function resendTarget(logId: string): Promise<{ ok: true; bookingId: string; type: ResendableType } | { ok: false; reason: ResendRefusal }> {
  const log = await prisma.notificationLog.findUnique({ where: { id: logId }, select: { type: true, bookingId: true } })
  if (!log) return { ok: false, reason: 'not_found' }
  if (!isResendable(log.type)) return { ok: false, reason: 'not_resendable' }
  if (!log.bookingId) return { ok: false, reason: 'no_booking' }
  return { ok: true, bookingId: log.bookingId, type: log.type }
}

export async function resendNotification(bookingId: string, type: ResendableType, now: Date = new Date()): Promise<ResendResult> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, userId: true, bookingCode: true, status: true, paymentDeadline: true, confirmedAt: true, departureDate: true, ...billSelect,
      payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } },
      refunds: billRefunds,
    },
  })
  if (!b) return { ok: false, reason: 'not_found' }
  // Booking batal/hangus/draf: jangan meminta bayar atau mengingatkan berangkat. Pembayaran diterima boleh juga untuk booking selesai.
  const live = b.status === 'active' || (type === 'payment_confirmed' && b.status === 'completed')
  if (!live) return { ok: false, reason: 'inactive' }
  const bill = billOf(b)
  const done = (channels: ChannelOutcome[] | null): ResendResult => (channels ? { ok: true, bookingId: b.id, channels } : { ok: false, reason: 'not_applicable' })

  switch (type) {
    case 'invoice_issued':
      return done(await sendInvoiceNotification(b.id, { dedupe: false }))
    case 'payment_reminder_d1':
    case 'payment_reminder_d0':
      if (!b.paymentDeadline || bill.balance <= 0) return { ok: false, reason: 'not_applicable' }
      return done(await notify({ userId: b.userId, bookingId: b.id, event: { type, code: b.bookingCode, deadline: formatDeadline(b.paymentDeadline), balance: bill.balance, partial: bill.paid > 0 } }))
    case 'payment_confirmed':
      if (bill.paid <= 0) return { ok: false, reason: 'not_applicable' }
      return done(await notify({ userId: b.userId, bookingId: b.id, event: { type, code: b.bookingCode, balance: bill.balance } }))
    case 'departure_reminder_7d':
    case 'departure_reminder_1d':
      return departure(b, type, now)
  }
}

async function departure(b: { id: string; userId: string; bookingCode: string; confirmedAt: Date | null; departureDate: Date | null }, type: DepartureReminderType, now: Date): Promise<ResendResult> {
  if (!b.confirmedAt || !b.departureDate) return { ok: false, reason: 'not_applicable' }
  // Sisa hari SEBENARNYA (bukan jarak tipe): kirim ulang H-7 pada H-5 harus berkata "5 hari lagi". Hari-H atau sesudahnya = tak relevan lagi.
  const date = calendarDateOf(b.departureDate)
  const days = daysBetween(todayInApp(now), date)
  if (days < 1) return { ok: false, reason: 'not_applicable' }
  return { ok: true, bookingId: b.id, channels: await notify({ userId: b.userId, bookingId: b.id, event: { type, code: b.bookingCode, date: formatCalendarDate(date, DATE_LONG), days } }) }
}
