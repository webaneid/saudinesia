// GOWA — go-whatsapp-web-multidevice by aldinokemal, hosted on Sumopod.
// All WhatsApp sends go through this file. Never call GOWA directly elsewhere.
// Failures are logged and swallowed — WA must never block a booking operation.

const RETRY_ATTEMPTS = 2
const RETRY_DELAY_MS = 2000

interface SendPayload {
  phone: string
  message: string
}

function normalizePhone(phone: string): string {
  return phone.replace(/^\+/, '').replace(/^0/, '62').replace(/\s+/g, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function sendMessage(payload: SendPayload): Promise<void> {
  const url = process.env.WA_GATEWAY_URL
  const token = process.env.WA_GATEWAY_TOKEN
  if (!url) {
    console.error('[whatsapp] WA_GATEWAY_URL is not set')
    return
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
          phone: normalizePhone(payload.phone),
          message: payload.message,
        }),
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        lastError = `HTTP ${res.status}`
        if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS)
        continue
      }

      return
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS)
    }
  }

  // Best-effort: never throw, just log
  console.error(`[whatsapp] Failed to send to ${payload.phone} after retries: ${lastError}`)
}

export const whatsapp = { sendMessage }
