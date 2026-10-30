import type { NotificationEvent } from '@/lib/notifications/events'

// Template email: satu layout (tabel + CSS inline — kompatibel klien email) dan konten per kejadian.
// SEMUA nilai dinamis (nama jamaah, kode booking, status) HARUS lewat `esc()`: nama yang diketik pengguna bisa berisi HTML.
// Konten disusun sebagai data (paragraf polos + fakta) lalu dirender ke HTML dan teks dari sumber yang sama.

export type EmailContent = { subject: string; html: string; text: string }
export type EmailContext = { name: string; bookingId?: string | null }

export type EmailBody = {
  subject: string
  preheader: string
  heading: string
  paragraphs: string[]
  facts?: [label: string, value: string][]
  cta?: { label: string; path: string }
  footnote?: string
}

const BRAND = '#04543e'
const INK = '#15241e'
const MUTED = '#5c6a64'

export function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Origin publik untuk tautan. Kosong → tombol/tautan TIDAK dibuat (tidak pernah tautan relatif di email). */
export function appUrl(): string {
  const configured = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/$/, '')
  // Kemudahan dev: tanpa APP_URL tautan tetap bisa diklik dari log. HANYA 'development' persis (fail-closed, SEC-02).
  return configured || (process.env.NODE_ENV === 'development' ? 'http://localhost:6260' : '')
}

function bookingPath(id?: string | null): string {
  return id ? `/id/bookings/${encodeURIComponent(id)}` : '/id/dashboard'
}

function bodyFor(e: NotificationEvent, ctx: EmailContext): EmailBody {
  const bookingCta = { label: 'Lihat detail booking', path: bookingPath(ctx.bookingId) }
  switch (e.type) {
    case 'booking_submitted':
      return {
        subject: `Booking ${e.code} berhasil dibuat`,
        preheader: `Selesaikan pembayaran${e.deadline ? ` sebelum ${e.deadline}` : ''}.`,
        heading: 'Booking Anda sudah kami terima',
        paragraphs: [
          `Halo ${ctx.name}, terima kasih telah memesan di Saudinesia.`,
          'Selesaikan pembayaran sebelum batas waktu agar tempat Anda tetap aman, lalu unggah bukti transfer di halaman booking.',
        ],
        facts: [['Kode booking', e.code], ...(e.deadline ? ([['Batas pembayaran', e.deadline]] as [string, string][]) : [])],
        cta: bookingCta,
      }
    case 'payment_reminder_d1':
    case 'payment_reminder_d0':
      return {
        subject: `Pengingat pembayaran booking ${e.code}`,
        preheader: `Batas pembayaran: ${e.deadline}.`,
        heading: 'Pembayaran belum kami terima',
        paragraphs: [
          `Halo ${ctx.name}, pembayaran untuk booking Anda belum kami terima.`,
          'Segera lakukan pembayaran agar tempat Anda tetap aman.',
        ],
        facts: [['Kode booking', e.code], ['Batas pembayaran', e.deadline]],
        cta: bookingCta,
      }
    case 'payment_confirmed':
      return {
        subject: `Pembayaran booking ${e.code} dikonfirmasi`,
        preheader: 'Terima kasih, pembayaran Anda sudah kami verifikasi.',
        heading: 'Pembayaran dikonfirmasi',
        paragraphs: [
          `Halo ${ctx.name}, pembayaran booking Anda telah dikonfirmasi. Terima kasih!`,
          'Dokumen perjalanan akan kami kirimkan segera setelah visa diproses.',
        ],
        facts: [['Kode booking', e.code]],
        cta: bookingCta,
      }
    case 'payment_rejected':
      return {
        subject: `Bukti pembayaran booking ${e.code} perlu diunggah ulang`,
        preheader: 'Bukti transfer belum dapat kami verifikasi.',
        heading: 'Bukti pembayaran belum dapat diverifikasi',
        paragraphs: [
          `Halo ${ctx.name}, bukti pembayaran untuk booking Anda tidak dapat kami verifikasi.`,
          'Mohon unggah ulang bukti transfer yang jelas dan terbaca.',
        ],
        facts: [['Kode booking', e.code]],
        cta: { label: 'Unggah ulang bukti', path: bookingPath(ctx.bookingId) },
      }
    case 'booking_expired':
      return {
        subject: `Booking ${e.code} hangus`,
        preheader: 'Pembayaran belum kami terima hingga mendekati tanggal keberangkatan.',
        heading: 'Booking hangus',
        paragraphs: [
          `Halo ${ctx.name}, booking Anda kami hanguskan karena belum ada pembayaran yang kami terima hingga mendekati tanggal keberangkatan.`,
          'Jika Anda masih ingin berangkat, silakan buat booking baru atau hubungi kami.',
        ],
        facts: [['Kode booking', e.code]],
      }
    case 'visa_status_change':
      return {
        subject: `Update visa booking ${e.code}: ${e.status}`,
        preheader: `Status visa Anda: ${e.status}.`,
        heading: 'Status visa diperbarui',
        paragraphs: [`Halo ${ctx.name}, ada pembaruan status visa untuk booking Anda.`],
        facts: [['Kode booking', e.code], ['Status visa', e.status]],
        cta: bookingCta,
      }
    case 'contact_changed':
      return {
        subject: 'Nomor kontak akun Saudinesia Anda diubah',
        preheader: 'Periksa bila perubahan ini bukan dari Anda.',
        heading: 'Nomor kontak akun diubah',
        paragraphs: [
          `Halo ${ctx.name}, nomor telepon atau WhatsApp pada akun Saudinesia Anda baru saja diubah.`,
          'Jika ini bukan Anda, segera atur ulang password Anda dan hubungi kami.',
        ],
        cta: { label: 'Periksa profil', path: '/id/profile' },
      }
    case 'welcome':
      return {
        subject: 'Selamat datang di Saudinesia',
        preheader: 'Akun Anda sudah aktif.',
        heading: `Selamat datang, ${e.name}`,
        paragraphs: [
          'Akun Saudinesia Anda sudah aktif. Anda dapat menjelajahi paket umrah, hotel, transportasi, dan layanan lainnya, lalu memesan langsung dari akun Anda.',
        ],
        cta: { label: 'Mulai jelajahi', path: '/id' },
      }
    case 'test':
      return {
        subject: 'Email uji Saudinesia',
        preheader: 'Konfigurasi email Anda berfungsi.',
        heading: 'Email uji berhasil dikirim',
        paragraphs: ['Jika Anda membaca pesan ini, pengiriman email lewat Resend sudah terkonfigurasi dengan benar.'],
        footnote: 'Pesan ini dikirim dari panel admin dan tidak berkaitan dengan booking apa pun.',
      }
  }
}

export function emailContent(e: NotificationEvent, ctx: EmailContext): EmailContent {
  return renderEmail(bodyFor(e, ctx))
}

/** Render layout bersama dari satu `EmailBody` — dipakai juga email auth (lib/email/authTemplates.ts). */
export function renderEmail(b: EmailBody): EmailContent {
  const base = appUrl()
  const ctaUrl = b.cta && base ? `${base}${b.cta.path}` : null

  const paragraphs = b.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK}">${esc(p)}</p>`).join('')
  const facts = b.facts?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;width:100%;border:1px solid #e5e0d0;border-radius:8px;background:#f8f5ec">${b.facts
        .map(
          ([k, v]) =>
            `<tr><td style="padding:10px 14px;font-size:13px;color:${MUTED};width:42%">${esc(k)}</td><td style="padding:10px 14px;font-size:14px;font-weight:600;color:${INK}">${esc(v)}</td></tr>`,
        )
        .join('')}</table>`
    : ''
  const cta = ctaUrl
    ? `<p style="margin:6px 0 20px"><a href="${esc(ctaUrl)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px">${esc(b.cta!.label)}</a></p>`
    : ''
  const foot = b.footnote ? `<p style="margin:0 0 10px;font-size:12px;color:${MUTED}">${esc(b.footnote)}</p>` : ''

  const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(b.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1e8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${BRAND};padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.3px">Saudinesia</td></tr>
<tr><td style="padding:26px 24px 8px"><h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:${INK}">${esc(b.heading)}</h1>${paragraphs}${facts}${cta}${foot}</td></tr>
<tr><td style="padding:14px 24px 22px;border-top:1px solid #eee8d8;font-size:12px;line-height:1.5;color:${MUTED}">Email ini dikirim otomatis oleh Saudinesia — layanan umrah &amp; haji untuk jamaah Indonesia.${base ? ` <a href="${esc(base)}" style="color:${MUTED}">${esc(base.replace(/^https?:\/\//, ''))}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`

  const text = [
    b.heading,
    '',
    ...b.paragraphs,
    ...(b.facts?.length ? ['', ...b.facts.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(ctaUrl ? ['', `${b.cta!.label}: ${ctaUrl}`] : []),
    ...(b.footnote ? ['', b.footnote] : []),
    '',
    '— Saudinesia',
  ].join('\n')

  return { subject: b.subject, html, text }
}
