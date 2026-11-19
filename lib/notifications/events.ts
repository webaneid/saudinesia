import { waTemplates } from '@/lib/notifications/templates/whatsapp'
import { DATETIME_LONG, formatInstant } from '@/lib/time'
import { appUrl } from '@/lib/email/templates'
import { departureDays, type DepartureReminderType } from '@/lib/notifications/departure'

// Semua kejadian notifikasi di SATU union (docs/arsitektur-notifikasi.md §3–4). Menambah kejadian = tambah satu varian di sini;
// `waMessage` dan `emailContent` (lib/email/templates.ts) memakai `switch` yang lengkap, jadi kompiler memaksa kedua kanal diisi.
export type NotificationEvent =
  | { type: 'booking_submitted'; code: string; deadline: string | null }
  /** Invoice terbit (Fase 6c): tautan invoice publik (`path` relatif, mis. `/id/invoice/<token>`; null bila tautan tak dapat dibuat). Revisi TIDAK memicu ini (D13). */
  | { type: 'invoice_issued'; code: string; number: string; total: string; dueDate: string | null; path: string | null }
  /** `balance` = sisa tagihan; `partial` = sudah ada pembayaran terverifikasi (DP/cicilan, Fase 7a F4). Opsional demi kejadian lama. */
  | { type: 'payment_reminder_d1'; code: string; deadline: string; balance?: number; partial?: boolean }
  | { type: 'payment_reminder_d0'; code: string; deadline: string; balance?: number; partial?: boolean }
  /** `balance` > 0 = pembayaran sebagian (DP/cicilan, Fase 7a F3): pesan menyebut sisa tagihan. */
  | { type: 'payment_confirmed'; code: string; balance?: number }
  | { type: 'payment_rejected'; code: string }
  | { type: 'booking_expired'; code: string }
  /** Pengingat keberangkatan H-7 / H-1 (docs/arsitektur-notifikasi.md §13): `date` = tanggal berangkat terformat (tanggal kalender). Isi sengaja hanya tanggal (K4). */
  | { type: DepartureReminderType; code: string; date: string; /** Sisa hari sebenarnya — diisi kirim ulang (§14) bila tak sama dengan jarak tipe; kosong = jarak tipe. */ days?: number }
  /** Dibatalkan staf (Fase 7b-2a). `money` = sudah ada uang masuk: pesan hanya menyebut tim akan menghubungi soal dana — tanpa jumlah/keputusan internal. */
  | { type: 'booking_cancelled'; code: string; money: boolean }
  | { type: 'visa_status_change'; code: string; status: string }
  /** Pemeriksaan data jamaah booking (Fase 6 modul jamaah): `status` = label tampil. Tanpa nama jamaah dan catatan petugas (dibaca di halaman booking). */
  | { type: 'pilgrim_review'; code: string; status: string }
  | { type: 'contact_changed' }
  | { type: 'welcome'; name: string }
  | { type: 'test' }

export type NotificationType = NotificationEvent['type']

/**
 * Pesan WhatsApp untuk kejadian ini; `null` = TIDAK dikirim lewat WhatsApp. Lingkup sengaja kecil (keputusan produk 2026-10-21, ADR-0001 —
 * gateway pihak ketiga makin sering memblokir): hanya konfirmasi booking, pengingat pembayaran, pembayaran dikonfirmasi/ditolak, dan pengingat keberangkatan
 * (ditambahkan pemilik 2026-11-19, §13 docs/arsitektur-notifikasi.md).
 * Status visa dan booking hangus hanya lewat email; ditinjau lagi nanti.
 */
export function waMessage(e: NotificationEvent): string | null {
  switch (e.type) {
    case 'booking_submitted':
      return waTemplates.bookingSubmitted(e.code, e.deadline ?? '-')
    case 'invoice_issued':
      return waTemplates.invoiceIssued(e.number, e.code, e.total, e.dueDate ?? '-', e.path ? `${appUrl()}${e.path}` : null)
    case 'payment_reminder_d1':
    case 'payment_reminder_d0':
      return waTemplates.paymentReminder(e.code, e.deadline, e.balance, e.partial)
    case 'payment_confirmed':
      return waTemplates.paymentConfirmed(e.code, e.balance)
    case 'payment_rejected':
      return waTemplates.paymentRejected(e.code)
    case 'departure_reminder_7d':
    case 'departure_reminder_1d':
      return waTemplates.departureReminder(e.code, e.days ?? departureDays(e.type), e.date)
    case 'booking_expired':
    case 'booking_cancelled':
    case 'visa_status_change':
    case 'pilgrim_review':
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
