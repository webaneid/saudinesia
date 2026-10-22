// GOWA — go-whatsapp-web-multidevice by aldinokemal, hosted on Sumopod.
// All WhatsApp sends go through this file. Never call GOWA directly elsewhere.
// sendMessage NEVER throws — WA must never block a booking operation — but it RETURNS the outcome so callers can log the
// truth (dulu hasilnya ditelan dan log notifikasi selalu mencatat "sent", termasuk saat gateway belum dikonfigurasi).

const RETRY_ATTEMPTS = 2
const RETRY_DELAY_MS = 2000

interface SendPayload {
  phone: string
  message: string
}

// Nomor disimpan sebagai digit E.164 (docs/arsitektur-auth.md §3.5) — dikirim apa adanya. Dulu awalan "62" dipaksakan pada nomor
// yang tidak berawalan 0, yang merusak nomor luar negeri.
function toGatewayNumber(phone: string): string {
  return phone.replace(/\D/g, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export type WhatsAppResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

async function sendMessage(payload: SendPayload): Promise<WhatsAppResult> {
  const url = process.env.WA_GATEWAY_URL
  const token = process.env.WA_GATEWAY_TOKEN
  if (!url) {
    console.error('[whatsapp] WA_GATEWAY_URL is not set')
    return { status: 'skipped', reason: 'WA_GATEWAY_URL belum diisi' }
  }

  let lastError: string | null = null

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${url}/app/send/message/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          phone: toGatewayNumber(payload.phone),
          message: payload.message,
        }),
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        lastError = `HTTP ${res.status}`
        if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS)
        continue
      }

      return { status: 'sent' }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS)
    }
  }

  // Best-effort: never throw. Nomor telepon sengaja TIDAK dicatat di log (PII) — SEC-09.
  console.error(`[whatsapp] Failed to send after retries: ${lastError}`)
  return { status: 'failed', error: lastError ?? 'unknown' }
}

export type GatewayStatus = { reachable: boolean; connected: boolean | null }

/**
 * Status gateway untuk panel admin: dapat dijangkau? perangkat WhatsApp masuk (logged in)? GOWA tak punya event putus-koneksi, jadi hanya
 * diperiksa saat dipanggil. Tidak pernah melempar; bentuk respons yang tak dikenali → connected null (tidak diketahui).
 */
async function status(): Promise<GatewayStatus> {
  const url = process.env.WA_GATEWAY_URL
  if (!url) return { reachable: false, connected: null }
  const token = process.env.WA_GATEWAY_TOKEN
  try {
    const res = await fetch(`${url}/app/status`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { reachable: true, connected: null }
    const json = (await res.json().catch(() => null)) as { results?: { is_logged_in?: unknown; is_connected?: unknown } } | null
    const r = json?.results
    const flag = typeof r?.is_logged_in === 'boolean' ? r.is_logged_in : typeof r?.is_connected === 'boolean' ? r.is_connected : null
    return { reachable: true, connected: flag }
  } catch {
    return { reachable: false, connected: null }
  }
}

export const whatsapp = { sendMessage, status }
