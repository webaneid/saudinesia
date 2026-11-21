import { waTemplates } from '@/lib/notifications/templates/whatsapp'
import { DATETIME_LONG, formatInstant } from '@/lib/time'
import { appUrl } from '@/lib/email/templates'
import { departureDays, type DepartureReminderType } from '@/lib/notifications/departure'
import { formatRupiah } from '@/lib/utils'
import { renderWa, type WaRendered } from '@/lib/whatsapp/templates'

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

/** Tautan invoice hanya bila HTTPS (http hanya di development) — selain itu kosong dan barisnya hilang dari pesan. */
function invoiceLink(path: string | null): string {
  if (!path) return ''
  const url = `${appUrl()}${path}`
  return /^https:\/\//.test(url) || (process.env.NODE_ENV === 'development' && /^http:\/\//.test(url)) ? url : ''
}
const rupiah = (n: number | undefined): string => (n && n > 0 ? formatRupiah(n) : '')

/**
 * Pesan WhatsApp untuk kejadian ini; `null` = kejadian TIDAK dikirim lewat WhatsApp; `disabled` = dimatikan admin (Sistem → WhatsApp, K2).
 * Lingkup sengaja kecil (keputusan produk 2026-10-21, ADR-0001): invoice terbit, pengingat pembayaran, pembayaran dikonfirmasi/ditolak,
 * pengingat keberangkatan (§13 docs/arsitektur-notifikasi.md). Teksnya = template yang bisa diedit (lib/whatsapp/templateDefs.ts, F3);
 * `booking_submitted` (tak lagi dikirim kode mana pun sejak Fase 6c) tetap di kode. Tak pernah melempar.
 */
export async function waContent(e: NotificationEvent): Promise<WaRendered | null> {
  switch (e.type) {
    case 'booking_submitted':
      return { kind: 'message', text: waTemplates.bookingSubmitted(e.code, e.deadline ?? '-') }
    case 'invoice_issued':
      return renderWa('invoice_issued', { kodeBooking: e.code, nomorInvoice: e.number, total: e.total, jatuhTempo: e.dueDate ?? '-', tautanInvoice: invoiceLink(e.path) })
    case 'payment_reminder_d1':
    case 'payment_reminder_d0':
      return e.partial && e.balance && e.balance > 0
        ? renderWa('payment_reminder_partial', { kodeBooking: e.code, sisaTagihan: rupiah(e.balance), batasWaktu: e.deadline })
        : renderWa('payment_reminder_unpaid', { kodeBooking: e.code, tagihan: rupiah(e.balance), batasWaktu: e.deadline })
    case 'payment_confirmed':
      return e.balance && e.balance > 0
        ? renderWa('payment_confirmed_partial', { kodeBooking: e.code, sisaTagihan: rupiah(e.balance) })
        : renderWa('payment_confirmed_full', { kodeBooking: e.code })
    case 'payment_rejected':
      return renderWa('payment_rejected', { kodeBooking: e.code })
    case 'departure_reminder_7d':
    case 'departure_reminder_1d': {
      const days = e.days ?? departureDays(e.type)
      return renderWa('departure_reminder', { kodeBooking: e.code, hariLagi: days === 1 ? 'besok' : `${days} hari lagi`, tanggalBerangkat: e.date })
    }
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

/** Teks WhatsApp yang akan dikirim, atau null (tak lewat WhatsApp / dimatikan). */
export async function waMessage(e: NotificationEvent): Promise<string | null> {
  const c = await waContent(e)
  return c?.kind === 'message' ? c.text : null
}

/** Format batas waktu untuk pesan (zona aplikasi, bahasa Indonesia) — satu tempat, dipakai route dan cron. */
export function formatDeadline(d: Date): string {
  return formatInstant(d, DATETIME_LONG)
}
