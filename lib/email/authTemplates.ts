import { renderEmail, type EmailContent } from '@/lib/email/templates'

// Email auth (docs/arsitektur-auth.md §3.2). Tautan membawa token di query string; path dibangun dari APP_URL oleh renderEmail,
// jadi tanpa APP_URL (di luar development) tombol tidak ada — pemanggil (authEmail.ts) menolak mengirim email tanpa tautan.

export type AuthEmailKind = 'registration' | 'already_registered' | 'password_reset'

export type AuthEmailContext = { name: string; locale: string; token?: string; whatsappMasked?: string }

export function authEmailContent(kind: AuthEmailKind, ctx: AuthEmailContext): EmailContent {
  const q = ctx.token ? `?token=${encodeURIComponent(ctx.token)}` : ''
  switch (kind) {
    case 'registration':
      return renderEmail({
        subject: 'Selesaikan pendaftaran Saudinesia Anda',
        preheader: 'Klik tombol untuk membuat password dan mengaktifkan akun.',
        heading: 'Satu langkah lagi untuk mengaktifkan akun',
        paragraphs: [
          `Halo ${ctx.name}, kami menerima pendaftaran akun Saudinesia dengan alamat email ini.`,
          'Klik tombol di bawah untuk memilih password dan mengaktifkan akun. Tautan berlaku 24 jam dan hanya bisa dipakai sekali.',
        ],
        facts: ctx.whatsappMasked ? [['Nomor WhatsApp terdaftar', ctx.whatsappMasked]] : undefined,
        cta: { label: 'Buat password & aktifkan akun', path: `/${ctx.locale}/register/complete${q}` },
        footnote: 'Bukan Anda yang mendaftar? Abaikan email ini — tidak ada akun yang dibuat sebelum tautan diklik.',
      })
    case 'already_registered':
      return renderEmail({
        subject: 'Anda sudah punya akun Saudinesia',
        preheader: 'Alamat email ini sudah terdaftar.',
        heading: 'Alamat email ini sudah terdaftar',
        paragraphs: [
          `Halo ${ctx.name}, seseorang (mungkin Anda) mencoba mendaftar dengan alamat email ini, tetapi akun Saudinesia dengan email ini sudah ada.`,
          'Silakan masuk. Jika lupa password, gunakan "Lupa password" di halaman masuk.',
        ],
        cta: { label: 'Masuk', path: `/${ctx.locale}/login` },
        footnote: 'Bukan Anda? Abaikan email ini — akun Anda tidak berubah.',
      })
    case 'password_reset':
      return renderEmail({
        subject: 'Atur ulang password Saudinesia',
        preheader: 'Tautan berlaku 30 menit.',
        heading: 'Atur ulang password',
        paragraphs: [
          `Halo ${ctx.name}, kami menerima permintaan untuk mengatur ulang password akun Saudinesia Anda.`,
          'Klik tombol di bawah untuk memilih password baru. Tautan berlaku 30 menit dan hanya bisa dipakai sekali.',
        ],
        cta: { label: 'Pilih password baru', path: `/${ctx.locale}/reset-password${q}` },
        footnote: 'Bukan Anda yang meminta? Abaikan email ini — password Anda tidak berubah.',
      })
  }
}
