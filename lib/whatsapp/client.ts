// GOWA — go-whatsapp-web-multidevice (aldinokemal) v9, self-host di VPS sendiri sebagai layanan `gowa` di jaringan internal compose
// (docs/rencana-gowa-self-host.md). SATU-SATUNYA pemanggil GOWA — jangan `fetch` ke GOWA di tempat lain.
// API (openapi v9.9.0): Basic auth (`APP_BASIC_AUTH`), `POST /send/message`, `GET /app/status|login|login-with-code|logout|reconnect`.
// Satu perangkat bawaan (dibuat GOWA saat start) → tanpa header `X-Device-Id`.
// Tidak ada fungsi yang melempar: WhatsApp tak boleh memblokir operasi booking; hasil dikembalikan agar pemanggil mencatat kebenaran.
// Nomor dan isi pesan tidak pernah dicatat di log (SEC-09).
import { redactPii } from '@/lib/log'

const RETRY_ATTEMPTS = 2
const RETRY_DELAY_MS = 2000
/** Gambar QR GOWA ±1–3 KB; batas longgar menolak respons janggal tanpa membaca tanpa batas. */
const QR_MAX_BYTES = 256 * 1024
/** Jalur gambar QR yang sah (`statics/qrcode/scan-qr-<uuid>.png`). Hanya JALUR yang diambil dari `qr_link` — host-nya diabaikan dan
 *  gambar selalu diambil dari `WA_GATEWAY_URL`, jadi respons GOWA tak bisa mengarahkan server ke alamat lain (SSRF). */
const QR_PATH = /^\/statics\/qrcode\/[A-Za-z0-9._-]{1,120}\.png$/
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

interface SendPayload {
  phone: string
  message: string
}

type Gateway = { base: string; headers: Record<string, string> }

/** Konfigurasi dari env, dibaca setiap panggilan (uji mengubah env saat jalan). Kredensial Basic hanya bila user DAN sandi terisi. */
function gateway(): Gateway | null {
  const base = process.env.WA_GATEWAY_URL?.trim().replace(/\/+$/, '')
  if (!base) return null
  const user = process.env.WA_GATEWAY_USER?.trim()
  const pass = process.env.WA_GATEWAY_PASSWORD?.trim()
  return { base, headers: user && pass ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` } : {} }
}

export function gatewayConfigured(): { url: boolean; credentials: boolean } {
  return { url: Boolean(process.env.WA_GATEWAY_URL?.trim()), credentials: Boolean(process.env.WA_GATEWAY_USER?.trim() && process.env.WA_GATEWAY_PASSWORD?.trim()) }
}

// Nomor disimpan sebagai digit E.164 (docs/arsitektur-auth.md §3.5) — dikirim apa adanya.
function toGatewayNumber(phone: string): string {
  return phone.replace(/\D/g, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** GET JSON ke GOWA; `null` = tak terjangkau. `results` diteruskan apa adanya (unknown) untuk dipersempit pemanggil. */
async function getJson(path: string, timeoutMs: number): Promise<{ http: number; results: unknown; code: string | null } | null> {
  const g = gateway()
  if (!g) return null
  try {
    const res = await fetch(`${g.base}${path}`, { headers: g.headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    const json = (await res.json().catch(() => null)) as { results?: unknown; code?: unknown } | null
    return { http: res.status, results: json?.results ?? null, code: typeof json?.code === 'string' ? json.code : null }
  } catch {
    return null
  }
}

const field = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined)

export type WhatsAppResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

async function sendMessage(payload: SendPayload): Promise<WhatsAppResult> {
  const g = gateway()
  if (!g) {
    console.error('[whatsapp] WA_GATEWAY_URL is not set')
    return { status: 'skipped', reason: 'WA_GATEWAY_URL belum diisi' }
  }

  let lastError: string | null = null

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${g.base}/send/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...g.headers },
        body: JSON.stringify({ phone: toGatewayNumber(payload.phone), message: payload.message }),
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      })

      if (!res.ok) {
        lastError = `HTTP ${res.status}`
        // 401/400 tidak akan sembuh dengan mencoba ulang (kredensial salah / nomor tak sah).
        if (res.status === 401 || res.status === 400) break
        if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS)
        continue
      }

      return { status: 'sent' }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS)
    }
  }

  console.error(`[whatsapp] Failed to send after retries: ${redactPii(lastError ?? 'unknown')}`)
  return { status: 'failed', error: lastError ?? 'unknown' }
}

export type GatewayStatus = {
  /** GOWA menjawab. */
  reachable: boolean
  /** Perangkat WhatsApp masuk (logged in); null = tidak diketahui (bentuk respons tak dikenal / kredensial ditolak). */
  connected: boolean | null
  /** Kredensial Basic ditolak (401) — salah konfigurasi, bukan "terputus". */
  unauthorized: boolean
  /** Digit nomor yang tertaut (dari JID), null bila belum masuk. Hanya untuk panel superadmin. */
  phone: string | null
}

/** Digit nomor dari JID `628…@s.whatsapp.net` / `628…:12@s.whatsapp.net`. */
export function jidDigits(jid: unknown): string | null {
  if (typeof jid !== 'string') return null
  const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid.trim())
  return m ? m[1]! : null
}

/** Status gateway (dibaca saat dipanggil; GOWA tak punya event putus-koneksi). Tak pernah melempar. */
async function status(): Promise<GatewayStatus> {
  const r = await getJson('/app/status', 4000)
  if (!r) return { reachable: false, connected: null, unauthorized: false, phone: null }
  if (r.http === 401) return { reachable: true, connected: null, unauthorized: true, phone: null }
  if (r.http !== 200) return { reachable: true, connected: null, unauthorized: false, phone: null }
  const loggedIn = field(r.results, 'is_logged_in')
  const connected = typeof loggedIn === 'boolean' ? loggedIn : null
  return { reachable: true, connected, unauthorized: false, phone: connected ? jidDigits(field(r.results, 'jid')) : null }
}

export type LoginQr =
  | { ok: true; dataUri: string; durationSec: number }
  | { ok: false; reason: 'unconfigured' | 'unreachable' | 'unauthorized' | 'alreadyConnected' | 'failed' }

/**
 * Minta QR masuk dan ambil GAMBARNYA di server (GOWA tak pernah publik): kembalikan data URI PNG. `qr_link` dari GOWA memuat host
 * permintaan; hanya jalurnya (divalidasi `QR_PATH`) yang dipakai, digabung dengan `WA_GATEWAY_URL`.
 */
async function loginQr(): Promise<LoginQr> {
  const g = gateway()
  if (!g) return { ok: false, reason: 'unconfigured' }
  const st = await status()
  if (!st.reachable) return { ok: false, reason: 'unreachable' }
  if (st.unauthorized) return { ok: false, reason: 'unauthorized' }
  if (st.connected) return { ok: false, reason: 'alreadyConnected' }
  const r = await getJson('/app/login', 15_000)
  if (!r) return { ok: false, reason: 'unreachable' }
  if (r.http === 401) return { ok: false, reason: 'unauthorized' }
  if (r.http !== 200) return { ok: false, reason: 'failed' }
  let path: string
  try {
    path = new URL(String(field(r.results, 'qr_link') ?? '')).pathname
  } catch {
    return { ok: false, reason: 'failed' }
  }
  if (!QR_PATH.test(path)) return { ok: false, reason: 'failed' }
  const dur = Number(field(r.results, 'qr_duration'))
  try {
    const img = await fetch(`${g.base}${path}`, { headers: g.headers, signal: AbortSignal.timeout(5000), redirect: 'error' })
    if (!img.ok) return { ok: false, reason: 'failed' }
    const declared = Number(img.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > QR_MAX_BYTES) return { ok: false, reason: 'failed' }
    const buf = Buffer.from(await img.arrayBuffer())
    if (buf.byteLength > QR_MAX_BYTES || !PNG_MAGIC.every((b, i) => buf[i] === b)) return { ok: false, reason: 'failed' }
    return { ok: true, dataUri: `data:image/png;base64,${buf.toString('base64')}`, durationSec: Number.isFinite(dur) && dur > 0 && dur <= 300 ? Math.round(dur) : 30 }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

export type PairCode =
  | { ok: true; code: string }
  | { ok: false; reason: 'unconfigured' | 'unreachable' | 'unauthorized' | 'alreadyConnected' | 'failed' }

/** Masuk dengan kode pasangan (tanpa kamera) untuk `phoneDigits` — pemanggil hanya mengirim nomor bisnis (keputusan K6). */
async function loginWithCode(phoneDigits: string): Promise<PairCode> {
  if (!gateway()) return { ok: false, reason: 'unconfigured' }
  if (!/^\d{8,15}$/.test(phoneDigits)) return { ok: false, reason: 'failed' }
  const st = await status()
  if (!st.reachable) return { ok: false, reason: 'unreachable' }
  if (st.unauthorized) return { ok: false, reason: 'unauthorized' }
  if (st.connected) return { ok: false, reason: 'alreadyConnected' }
  const r = await getJson(`/app/login-with-code?phone=${phoneDigits}`, 20_000)
  if (!r) return { ok: false, reason: 'unreachable' }
  if (r.http === 401) return { ok: false, reason: 'unauthorized' }
  const code = field(r.results, 'pair_code')
  if (r.http !== 200 || typeof code !== 'string' || !/^[A-Z0-9-]{6,12}$/.test(code)) return { ok: false, reason: 'failed' }
  return { ok: true, code }
}

export type GatewayAction = { ok: true } | { ok: false; reason: 'unconfigured' | 'unreachable' | 'unauthorized' | 'failed' }

async function simple(path: string): Promise<GatewayAction> {
  if (!gateway()) return { ok: false, reason: 'unconfigured' }
  const r = await getJson(path, 15_000)
  if (!r) return { ok: false, reason: 'unreachable' }
  if (r.http === 401) return { ok: false, reason: 'unauthorized' }
  return r.http === 200 ? { ok: true } : { ok: false, reason: 'failed' }
}

/** Keluarkan nomor dari WhatsApp (sesi dihapus; slot perangkat tetap — scan QR lagi untuk menyambung). */
const logout = () => simple('/app/logout')
/** Sambung ulang ke server WhatsApp dengan sesi yang ada (tanpa scan). */
const reconnect = () => simple('/app/reconnect')

export const whatsapp = { sendMessage, status, loginQr, loginWithCode, logout, reconnect }
