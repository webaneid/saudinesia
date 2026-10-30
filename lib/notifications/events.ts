import { waTemplates } from '@/lib/notifications/templates/whatsapp'
import { DATETIME_LONG, formatInstant } from '@/lib/time'

// Semua kejadian notifikasi di SATU union (docs/arsitektur-notifikasi.md §3–4). Menambah kejadian = tambah satu varian di sini;
// `waMessage` dan `emailContent` (lib/email/templates.ts) memakai `switch` yang lengkap, jadi kompiler memaksa kedua kanal diisi.
export type NotificationEvent =
  | { type: 'booking_submitted'; code: string; deadline: string | null }
  | { type: 'payment_reminder_12h'; code: string; deadline: string }
  | { type: 'payment_reminder_22h'; code: string; deadline: string }
  | { type: 'payment_confirmed'; code: string }
  | { type: 'payment_rejected'; code: string }
  | { type: 'auto_cancelled'; code: string }
  | { type: 'visa_status_change'; code: string; status: string }
  | { type: 'contact_changed' }
  | { type: 'welcome'; name: string }
  | { type: 'test' }

export type NotificationType = NotificationEvent['type']

/**
 * Pesan WhatsApp untuk kejadian ini; `null` = TIDAK dikirim lewat WhatsApp. Lingkup sengaja kecil (keputusan produk 2026-10-21, ADR-0001 —
 * gateway pihak ketiga makin sering memblokir): hanya konfirmasi booking, pengingat pembayaran, dan pembayaran dikonfirmasi/ditolak.
 * Status visa dan pembatalan otomatis hanya lewat email; ditinjau lagi nanti.
 */
export function waMessage(e: NotificationEvent): string | null {
  switch (e.type) {
    case 'booking_submitted':
      return waTemplates.bookingSubmitted(e.code, e.deadline ?? '-')
    case 'payment_reminder_12h':
    case 'payment_reminder_22h':
      return waTemplates.paymentReminder(e.code, e.deadline)
    case 'payment_confirmed':
      return waTemplates.paymentConfirmed(e.code)
    case 'payment_rejected':
      return waTemplates.paymentRejected(e.code)
    case 'auto_cancelled':
    case 'visa_status_change':
    case 'contact_changed':
    case 'welcome':
    case 'test':
      return null
  }
}

/** Format batas waktu untuk pesan (zona aplikasi, bahasa Indonesia) — satu tempat, dipakai route dan cron. */
export function formatDeadline(d: Date): string {
  return formatInstant(d, DATETIME_LONG)
}
