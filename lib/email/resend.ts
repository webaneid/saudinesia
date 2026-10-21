// Satu-satunya tempat yang memanggil Resend (docs/arsitektur-notifikasi.md). Pola mengikuti smart-ai: HTTP API langsung,
// tanpa SDK. `sendEmail` TIDAK PERNAH melempar — email tidak boleh menggagalkan operasi bisnis — tetapi mengembalikan hasil
// jujur: 'sent' (diterima Resend; bukan jaminan masuk inbox), 'skipped' (kredensial belum diisi) atau 'failed'.

export type EmailInput = {
  to: string
  subject: string
  html: string
  text: string
  /** Mencegah pengiriman ganda saat retry (Resend menyimpan kunci 24 jam). */
  idempotencyKey?: string
}

export type EmailResult =
  | { status: 'sent'; id: string | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [500, 1500]
const TIMEOUT_MS = 8000
const MAX_RETRY_AFTER_MS = 5000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Endpoint Resend. Override HANYA di development/test (uji dengan server palsu) — fail-closed di lingkungan lain. */
function apiBase(): string {
  const override = process.env.RESEND_API_URL
  const allowOverride = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
  return (override && allowOverride ? override : 'https://api.resend.com').replace(/\/$/, '')
}

export function emailFrom(): string | null {
  return process.env.RESEND_FROM?.trim() || null
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && emailFrom())
}

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = emailFrom()
  if (!apiKey || !from) {
    return { status: 'skipped', reason: !apiKey ? 'RESEND_API_KEY belum diisi' : 'RESEND_FROM belum diisi' }
  }
  if (!EMAIL_RE.test(input.to)) return { status: 'failed', error: 'Alamat email tujuan tidak valid' }

  // Subjek satu baris: CR/LF dibuang (tidak ada header injection walau API-nya JSON).
  const subject = input.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 250)
  const replyTo = process.env.RESEND_REPLY_TO?.trim()
  const body = JSON.stringify({
    from,
    to: [input.to],
    subject,
    html: input.html,
    text: input.text,
    ...(replyTo ? { reply_to: replyTo } : {}),
  })

  let lastError = 'unknown'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let retryAfterMs = 0
    try {
      const res = await fetch(`${apiBase()}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (res.ok) {
        const json = (await res.json().catch(() => null)) as { id?: string } | null
        return { status: 'sent', id: json?.id ?? null }
      }

      // Pesan galat dipotong; kunci API tidak pernah ada di respons maupun di log.
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
      // Penyedia kadang memantulkan kunci di pesan galat — redaksi eksplisit sebelum disimpan/dicatat.
      lastError = `HTTP ${res.status}${detail ? `: ${detail.split(apiKey).join('[redacted]')}` : ''}`
      // 4xx (kecuali 429) = permintaan/kunci/domain salah — mengulang tidak membantu.
      if (res.status !== 429 && res.status < 500) return { status: 'failed', error: lastError }
      const ra = Number(res.headers.get('retry-after'))
      if (res.status === 429 && Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, MAX_RETRY_AFTER_MS)
    } catch (e) {
      lastError = (e instanceof Error ? e.message : String(e)).split(apiKey).join('[redacted]') // jaringan/timeout → coba lagi
    }

    if (attempt < MAX_ATTEMPTS) await sleep(retryAfterMs || BACKOFF_MS[attempt - 1] || 1500)
  }
  console.error(`[email] gagal setelah ${MAX_ATTEMPTS} percobaan: ${lastError}`)
  return { status: 'failed', error: lastError }
}
