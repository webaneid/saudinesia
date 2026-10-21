import { emailConfigured, emailFrom } from '@/lib/email/resend'
import { appUrl } from '@/lib/email/templates'

// Status integrasi untuk panel admin (docs/arsitektur-notifikasi.md §6). HANYA boolean dan nilai publik — kunci/rahasia
// tidak pernah dibaca ke luar modul ini. Admin melihat "terkonfigurasi atau belum"; nilainya tetap hanya di env server.

export type IntegrationStatus = {
  appUrl: { set: boolean; value: string | null }
  email: { configured: boolean; hasApiKey: boolean; from: string | null; hasReplyTo: boolean }
  whatsapp: { configured: boolean; hasToken: boolean }
  google: { configured: boolean; redirectUri: string | null }
}

export function integrationStatus(): IntegrationStatus {
  const base = appUrl()
  return {
    appUrl: { set: Boolean(base), value: base || null },
    email: {
      configured: emailConfigured(),
      hasApiKey: Boolean(process.env.RESEND_API_KEY?.trim()),
      from: emailFrom(),
      hasReplyTo: Boolean(process.env.RESEND_REPLY_TO?.trim()),
    },
    whatsapp: { configured: Boolean(process.env.WA_GATEWAY_URL?.trim()), hasToken: Boolean(process.env.WA_GATEWAY_TOKEN?.trim()) },
    google: {
      configured: Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()),
      // URI yang HARUS didaftarkan di Google Cloud Console (Authorized redirect URIs).
      redirectUri: base ? `${base}/api/v1/auth/google/callback` : null,
    },
  }
}
