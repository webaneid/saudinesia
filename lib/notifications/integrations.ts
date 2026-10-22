import { emailConfigured, emailFrom } from '@/lib/email/resend'
import { appUrl } from '@/lib/email/templates'
import { googleConfigured, googleRedirectUri } from '@/lib/auth/google'
import { whatsapp, type GatewayStatus } from '@/lib/whatsapp/client'
import { businessWaDigits } from '@/lib/constants/payment'
import { webhookSecret } from '@/lib/whatsapp/webhook'

// Status integrasi untuk panel admin (docs/arsitektur-notifikasi.md §6). HANYA boolean dan nilai publik — kunci/rahasia
// tidak pernah dibaca ke luar modul ini. Admin melihat "terkonfigurasi atau belum"; nilainya tetap hanya di env server.

export type IntegrationStatus = {
  appUrl: { set: boolean; value: string | null }
  email: { configured: boolean; hasApiKey: boolean; from: string | null; hasReplyTo: boolean }
  whatsapp: {
    configured: boolean
    hasToken: boolean
    /** Webhook pesan masuk (verifikasi nomor): secret terisi? nomor bisnis terisi? URL yang harus dipasang di GOWA. */
    webhookSecretSet: boolean
    businessNumberSet: boolean
    webhookUrl: string | null
    /** Status langsung gateway (dibaca saat panel dibuka; GOWA tak punya event putus-koneksi). */
    gateway: GatewayStatus
  }
  google: { configured: boolean; redirectUri: string | null }
}

export async function integrationStatus(): Promise<IntegrationStatus> {
  const base = appUrl()
  const gateway = await whatsapp.status()
  return {
    appUrl: { set: Boolean(base), value: base || null },
    email: {
      configured: emailConfigured(),
      hasApiKey: Boolean(process.env.RESEND_API_KEY?.trim()),
      from: emailFrom(),
      hasReplyTo: Boolean(process.env.RESEND_REPLY_TO?.trim()),
    },
    whatsapp: {
      configured: Boolean(process.env.WA_GATEWAY_URL?.trim()),
      hasToken: Boolean(process.env.WA_GATEWAY_TOKEN?.trim()),
      // true hanya bila secret KUAT (≥32 karakter, bukan bawaan/placeholder) — sama dengan yang dipakai webhook; selain itu webhook mati.
      webhookSecretSet: webhookSecret() !== null,
      businessNumberSet: businessWaDigits() !== '',
      webhookUrl: base ? `${base}/api/v1/webhooks/whatsapp` : null,
      gateway,
    },
    // Satu sumber kebenaran (lib/auth/google.ts): panel admin menampilkan persis yang dipakai alur login.
    google: { configured: googleConfigured(), redirectUri: googleRedirectUri() },
  }
}
