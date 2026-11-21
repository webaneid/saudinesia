import { z } from 'zod'

// Tindakan di Sistem → WhatsApp (docs/rencana-gowa-self-host.md §4.1). Tanpa isian nomor: kode pasangan selalu untuk nomor bisnis (K6),
// kirim uji selalu ke nomor terverifikasi staf sendiri (ADR-0002).
export const WHATSAPP_ACTIONS = ['qr', 'pairCode', 'disconnect', 'reconnect', 'test'] as const
export const whatsappActionSchema = z.object({ action: z.enum(WHATSAPP_ACTIONS, { error: 'Tindakan tidak dikenal' }) }).strict()
export type WhatsappAction = z.infer<typeof whatsappActionSchema>['action']

/** Status panel (respons GET). Bentuk murni di sini supaya komponen klien tidak mengimpor modul server (lib/whatsapp/admin). */
export type WhatsappPanelStatus = {
  configured: boolean
  credentials: boolean
  webhookSecretSet: boolean
  /** Digit nomor bisnis (`NEXT_PUBLIC_BUSINESS_WA`, memang publik) — nomor yang SEHARUSNYA di-scan (K6). */
  businessNumber: string | null
  gateway: { reachable: boolean; connected: boolean | null; unauthorized: boolean; phone: string | null }
  /** Terhubung dengan nomor lain selain nomor bisnis → pesan `VERIF` jamaah tak pernah sampai ke gateway ini. */
  numberMismatch: boolean
}
