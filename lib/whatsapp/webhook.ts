import { completeWhatsappVerification, jidToDigits, parseVerificationMessage, verifyWebhookSignature } from '@/lib/auth/whatsappVerify'
import { consume, policy } from '@/lib/auth/rateLimit'
import { waTemplates } from '@/lib/notifications/templates/whatsapp'

// Logika webhook pesan masuk GOWA (ADR-0002), dipisah dari route supaya semua cabangnya bisa diuji otomatis tanpa Next. Route hanya membaca body
// (dengan batas ukuran), memanggil processWebhook(), lalu mengirim balasan yang diminta.

export const WEBHOOK_MAX_BODY_BYTES = 64_000
/** Pesan terlalu tua/terlalu di masa depan diabaikan (pertahanan berlapis terhadap replay; retry GOWA maksimal ±31 dtk). */
const MAX_AGE_MS = 10 * 60 * 1000
const MAX_FUTURE_MS = 5 * 60 * 1000

/** Nilai yang BUKAN secret sungguhan (bawaan GOWA / placeholder contoh) — diperlakukan sebagai "belum dikonfigurasi". */
const WEAK_SECRETS = new Set(['secret', 'ganti_dengan_string_acak_panjang', 'changeme', 'password', 'test'])
const MIN_SECRET_LENGTH = 32

/**
 * Secret webhook yang SAH, atau null (= webhook mati). Satu-satunya penjaga endpoint publik ini adalah HMAC, jadi secret lemah (bawaan GOWA
 * `secret`, placeholder `.env.example`, atau < 32 karakter) tidak diterima: bisa ditebak online dan memalsukan verifikasi nomor.
 * `scripts/buat-env-production.sh` membuat 64 karakter hex.
 */
export function webhookSecret(): string | null {
  const s = process.env.WHATSAPP_WEBHOOK_SECRET?.trim()
  if (!s || s.length < MIN_SECRET_LENGTH || WEAK_SECRETS.has(s.toLowerCase())) return null
  return s
}

export type WebhookInput = { rawBody: string; signature: string | null; ip: string | null }
export type WebhookReply = { phone: string; message: string }
export type WebhookOutcome = { status: number; error?: string; handled?: boolean; reply?: WebhookReply; retryAfterSec?: number }

type Payload = Record<string, unknown>
function parsePayload(raw: string): Payload | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return null
    const e = v as { event?: unknown; payload?: unknown }
    return e.event === 'message' && e.payload && typeof e.payload === 'object' ? (e.payload as Payload) : null
  } catch {
    return null // bukan JSON → diabaikan
  }
}

function fresh(timestamp: unknown, now = Date.now()): boolean {
  if (timestamp === undefined) return true // GOWA selalu menyertakannya; tak ada = tak bisa dinilai, jangan menolak pesan sah
  const t = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN
  return Number.isFinite(t) && now - t <= MAX_AGE_MS && t - now <= MAX_FUTURE_MS
}

export async function processWebhook({ rawBody, signature, ip }: WebhookInput): Promise<WebhookOutcome> {
  // FAIL-CLOSED: tanpa secret yang kuat endpoint mati — bukan terbuka.
  const secret = webhookSecret()
  if (!secret) return { status: 503, error: 'Webhook belum dikonfigurasi' }
  if (Buffer.byteLength(rawBody) > WEBHOOK_MAX_BODY_BYTES) return { status: 413, error: 'Terlalu besar' }

  if (!verifyWebhookSignature(secret, rawBody, signature)) {
    // GOWA yang sah tak pernah salah tanda tangan → setiap kegagalan dihitung per IP; menebak secret secara online ikut terblokir.
    if (ip) {
      const h = await consume(policy('webhookBadSigIp', ip))
      if (!h.allowed) return { status: 429, error: 'Terlalu banyak percobaan', retryAfterSec: h.retryAfterSec }
    }
    return { status: 401, error: 'Tanda tangan tidak valid' }
  }

  // Pagar kasar per IP sumber (semua pesan masuk ke nomor bisnis ikut terhitung — longgar).
  if (ip) {
    const h = await consume(policy('webhookIp', ip))
    if (!h.allowed) return { status: 429, error: 'Terlalu banyak permintaan', retryAfterSec: h.retryAfterSec }
  }

  const p = parsePayload(rawBody)
  if (!p || p.is_from_me === true || !fresh(p.timestamp)) return { status: 200, handled: false }

  // Hanya obrolan pribadi dengan JID nomor (bukan grup `@g.us`, bukan LID yang tak bisa dipetakan ke nomor), dan chat harus = pengirim.
  const chat = jidToDigits(p.chat_id)
  const sender = jidToDigits(p.from)
  const code = parseVerificationMessage(p.body)
  if (!sender || !code || chat !== sender) return { status: 200, handled: false }

  // Batas per PENGIRIM hanya untuk pesan verifikasi yang sah bentuknya: membatasi tebakan kode per nomor tanpa terganggu chat CS biasa.
  const bySender = await consume(policy('webhookSender', sender))
  if (!bySender.allowed) return { status: 200, handled: false }

  const result = await completeWhatsappVerification({ code, senderDigits: sender })

  // Balasan hanya untuk dua hasil yang berguna bagi pengirim — selalu ke pengirim sendiri (JID terautentikasi), tak bisa dipakai menyerang nomor lain.
  // 'invalid'/'mismatch' tidak dibalas: tak membocorkan apa pun dan tak bisa dijadikan alat spam.
  if (result.ok) return { status: 200, handled: true, reply: { phone: sender, message: waTemplates.whatsappVerified(maskEmail(result.email)) } }
  if (result.reason === 'taken') return { status: 200, handled: false, reply: { phone: sender, message: waTemplates.whatsappTaken() } }
  return { status: 200, handled: false }
}

/** j***@example.test — pemilik nomor mengenali akunnya (atau curiga bila itu bukan akunnya). */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}
