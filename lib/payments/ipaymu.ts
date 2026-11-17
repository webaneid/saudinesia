import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { parseAppDateTime } from '@/lib/time'

// Klien iPaymu API v2 (Fase 9, docs/arsitektur-booking-engine-v2.md §10.12) — SATU-SATUNYA tempat yang memanggil iPaymu.
// Kunci dari env (`IPAYMU_VA`, `IPAYMU_API_KEY`), tak pernah dari DB/klien; mode sandbox/produksi dari Pengaturan Invoice (`gatewaySandbox`).
// Konfigurasi bisa disuntik (uji memakai server tiruan) — kode aplikasi memakai `ipaymuFromEnv`.
// Diporting dari bantuanku/apps/api/src/services/payment/ipaymu.ts (signature, kanal + cache, /transaction, normalisasi callback).

export type IpaymuConfig = { va: string; apiKey: string; baseUrl: string }

const PROD_URL = 'https://my.ipaymu.com/api/v2'
const SANDBOX_URL = 'https://sandbox.ipaymu.com/api/v2'

/** Konfigurasi dari env; `null` bila kunci belum dipasang (metode iPaymu tak tampil — fail-closed). */
/** Sandbox hanya di development atau bila `IPAYMU_SANDBOX_ALLOWED=1` (SEC-257): di server sungguhan saklar sandbox di DB tak boleh membuat
 *  "lunas" tiruan mengonfirmasi kursi dan memosting kas — fail-closed (null = bayar online mati). */
export function sandboxAllowed(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.IPAYMU_SANDBOX_ALLOWED === '1'
}

export function ipaymuFromEnv(sandbox: boolean): IpaymuConfig | null {
  const va = process.env.IPAYMU_VA?.trim()
  const apiKey = process.env.IPAYMU_API_KEY?.trim()
  if (!va || !apiKey) return null
  if (sandbox && !sandboxAllowed()) return null
  return { va, apiKey, baseUrl: sandbox ? SANDBOX_URL : PROD_URL }
}

export class IpaymuError extends Error {
  constructor(readonly code: 'timeout' | 'http' | 'rejected' | 'malformed', message: string) { super(message); this.name = 'IpaymuError' }
}

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')

/** Signature permintaan iPaymu: HMAC-SHA256(apiKey, "METHOD:va:sha256(body):apiKey"), hex huruf kecil. */
export function requestSignature(cfg: Pick<IpaymuConfig, 'va' | 'apiKey'>, method: 'GET' | 'POST', bodyJson: string): string {
  return createHmac('sha256', cfg.apiKey).update(`${method}:${cfg.va}:${sha256Hex(bodyJson)}:${cfg.apiKey}`).digest('hex')
}

/** Header `timestamp` iPaymu: YYYYMMDDHHmmss (UTC, sesuai contoh resmi). */
const ipaymuTimestamp = (now = new Date()) => now.toISOString().replace(/[-T:.Z]/g, '').slice(0, 14)

async function call<T>(cfg: IpaymuConfig, method: 'GET' | 'POST', path: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const bodyJson = JSON.stringify(body)
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', va: cfg.va, signature: requestSignature(cfg, method, bodyJson), timestamp: ipaymuTimestamp() },
      // GET tetap ditandatangani atas "{}" (badan kosong ditolak iPaymu) tetapi tidak mengirim badan.
      body: method === 'POST' ? bodyJson : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    })
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new IpaymuError('timeout', `iPaymu ${path}: timeout`)
    throw new IpaymuError('http', `iPaymu ${path}: ${e instanceof Error ? e.name : 'galat jaringan'}`)
  }
  const text = await res.text()
  if (text.length > 200_000) throw new IpaymuError('malformed', `iPaymu ${path}: respons terlalu besar`)
  try { return JSON.parse(text) as T } catch { throw new IpaymuError('malformed', `iPaymu ${path}: HTTP ${res.status} bukan JSON`) }
}

// ── Kanal ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type IpaymuChannel = { id: string; group: string; code: string; name: string }
export type IpaymuChannelGroup = { code: string; name: string; channels: IpaymuChannel[] }

/** Kelompok yang alur bayarnya didukung halaman kita (K9-1 = semua yang aktif di akun, selama alurnya dikenal). */
export const SUPPORTED_GROUPS = ['va', 'qris', 'ewallet', 'cstore'] as const
const CHANNEL_TTL_MS = 10 * 60_000
const channelCache = new Map<string, { expiresAt: number; groups: IpaymuChannelGroup[] }>()
const SAFE_CODE = /^[a-z0-9_-]{1,40}$/

/** Kanal aktif merchant (GET /payment-channels), di-cache 10 menit per akun. Gagal → `[]` (metode online tak tampil; tak ada daftar tebakan). */
export async function listChannels(cfg: IpaymuConfig): Promise<IpaymuChannelGroup[]> {
  const key = `${cfg.baseUrl}|${cfg.va}`
  const hit = channelCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.groups
  try {
    const r = await call<{ Success?: boolean; Data?: Array<{ Code?: unknown; Name?: unknown; Channels?: Array<{ Code?: unknown; Name?: unknown }> }> }>(cfg, 'GET', '/payment-channels', {}, 8_000)
    if (!r.Success || !Array.isArray(r.Data)) throw new IpaymuError('malformed', 'payment-channels: respons tak sah')
    const groups: IpaymuChannelGroup[] = []
    for (const g of r.Data) {
      const code = String(g.Code ?? '').toLowerCase()
      if (!(SUPPORTED_GROUPS as readonly string[]).includes(code)) continue
      const channels = (g.Channels ?? [])
        .map(c => ({ code: String(c.Code ?? '').toLowerCase(), name: String(c.Name ?? '').slice(0, 80) }))
        .filter(c => SAFE_CODE.test(c.code) && c.name)
        // QRIS: kode kanal iPaymu "mpm", tetapi Direct Payment yang terbukti berjalan memakai "qris:qris" (catatan bantuanku).
        .map(c => code === 'qris' ? { id: 'qris:qris', group: 'qris', code: 'qris', name: c.name } : { id: `${code}:${c.code}`, group: code, code: c.code, name: c.name })
      const unique = [...new Map(channels.map(c => [c.id, c])).values()]
      if (unique.length > 0) groups.push({ code, name: String(g.Name ?? code).slice(0, 80), channels: unique })
    }
    groups.sort((a, b) => SUPPORTED_GROUPS.indexOf(a.code as never) - SUPPORTED_GROUPS.indexOf(b.code as never))
    channelCache.set(key, { expiresAt: Date.now() + CHANNEL_TTL_MS, groups })
    return groups
  } catch (e) {
    console.error('[ipaymu/channels]', e instanceof Error ? e.message : 'galat')
    channelCache.set(key, { expiresAt: Date.now() + 60_000, groups: [] })
    return []
  }
}

/** Untuk uji: kosongkan cache kanal. */
export function clearChannelCache(): void { channelCache.clear() }

// ── Buat transaksi (Direct Payment) ─────────────────────────────────────────────────────────────────────────────────

export type DirectInput = {
  referenceId: string; amount: number; channelId: string; expiredHours: number; notifyUrl: string
  buyer: { name: string; email: string; phone: string }; product: string
}
export type DirectResult = { trxId: string | null; payCode: string; channelName: string | null; expiresAt: Date | null; total: number }

/** iPaymu mengirim waktu sebagai teks WIB tanpa zona ("2026-10-24 23:03:23"). */
export function parseIpaymuTime(v: unknown): Date | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(v)) return null
  return parseAppDateTime(v.replace(' ', 'T'), 'Asia/Jakarta') // zona tetap iPaymu = WIB (bukan zona aplikasi)
}

export async function createDirect(cfg: IpaymuConfig, input: DirectInput): Promise<DirectResult> {
  const [method, channel] = input.channelId.split(':')
  if (!method || !channel || !SAFE_CODE.test(method) || !SAFE_CODE.test(channel)) throw new IpaymuError('rejected', 'kanal tak sah')
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new IpaymuError('rejected', 'nominal harus rupiah bulat')
  const r = await call<{ Success?: boolean; Message?: unknown; Data?: { TransactionId?: unknown; ReferenceId?: unknown; PaymentNo?: unknown; QrString?: unknown; PaymentUrl?: unknown; Url?: unknown; PaymentName?: unknown; Expired?: unknown; Total?: unknown } }>(cfg, 'POST', '/payment/direct', {
    account: cfg.va,
    name: input.buyer.name, email: input.buyer.email, phone: input.buyer.phone,
    amount: input.amount, notifyUrl: input.notifyUrl, expired: input.expiredHours, expiredType: 'hours',
    referenceId: input.referenceId, paymentMethod: method, paymentChannel: channel, feeDirection: 'MERCHANT',
    product: [input.product], qty: [1], price: [input.amount],
  }, 30_000)
  const d = r.Data
  if (!r.Success || !d) throw new IpaymuError('rejected', 'payment/direct ditolak') // pesan iPaymu tak dicatat (bisa memuat data pembeli)
  if (String(d.ReferenceId ?? input.referenceId) !== input.referenceId) throw new IpaymuError('malformed', 'payment/direct: ReferenceId tak cocok')
  const payCode = [d.QrString, d.PaymentNo, d.PaymentUrl, d.Url].find(v => typeof v === 'string' && v.length > 0 && v.length <= 2000) as string | undefined
  if (!payCode) throw new IpaymuError('malformed', 'payment/direct: tanpa kode bayar')
  const trx = d.TransactionId == null ? null : String(d.TransactionId)
  return {
    trxId: trx && /^[0-9A-Za-z_-]{1,80}$/.test(trx) ? trx : null,
    payCode,
    channelName: typeof d.PaymentName === 'string' ? d.PaymentName.slice(0, 120) : null,
    expiresAt: parseIpaymuTime(d.Expired),
    total: Number(d.Total ?? input.amount),
  }
}

// ── Status transaksi (sumber kebenaran) ─────────────────────────────────────────────────────────────────────────────

export type TrxState = 'paid' | 'pending' | 'expired' | 'failed'
export type TrxStatus = { state: TrxState; referenceId: string | null; amount: number; fee: number; paidAt: Date | null; trxId: string }

/** Kode status iPaymu: 1 berhasil, 6 berhasil (belum settle), 0 pending, -2 kedaluwarsa, lainnya gagal/batal/refund. */
export function trxState(code: unknown): TrxState {
  const n = Number(code)
  if (n === 1 || n === 6) return 'paid'
  if (n === 0) return 'pending'
  if (n === -2) return 'expired'
  return 'failed'
}

/** POST /transaction — SATU-SATUNYA dasar konfirmasi otomatis (isi callback tak pernah dipercaya untuk jumlah/status). */
export async function checkTransaction(cfg: IpaymuConfig, trxId: string): Promise<TrxStatus> {
  const r = await call<{ Success?: boolean; Data?: { TransactionId?: unknown; ReferenceId?: unknown; Status?: unknown; Amount?: unknown; Fee?: unknown; SuccessDate?: unknown; PaidDate?: unknown } }>(cfg, 'POST', '/transaction', { transactionId: trxId }, 15_000)
  const d = r.Data
  if (!r.Success || !d) throw new IpaymuError('rejected', 'transaction: tak ditemukan')
  const amount = Number(d.Amount)
  const fee = Number(d.Fee ?? 0)
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(fee) || fee < 0) throw new IpaymuError('malformed', 'transaction: nominal tak sah')
  if (d.TransactionId != null && String(d.TransactionId) !== trxId) throw new IpaymuError('malformed', 'transaction: id tak cocok')
  return { state: trxState(d.Status), referenceId: d.ReferenceId == null ? null : String(d.ReferenceId), amount, fee, paidAt: parseIpaymuTime(d.SuccessDate ?? d.PaidDate), trxId }
}

// ── Callback ────────────────────────────────────────────────────────────────────────────────────────────────────────

const CALLBACK_INT_FIELDS = ['trx_id', 'status_code', 'transaction_status_code', 'paid_off']

/**
 * X-Signature callback iPaymu: normalisasi tipe → kunci A-Z → JSON → HMAC-SHA256 hex dengan nomor VA. Dokumen tak menyebut apakah "/" di-escape (gaya PHP),
 * jadi beberapa serialisasi dicoba. Hanya SARINGAN AWAL + log — konfirmasi tetap lewat `checkTransaction`.
 */
export function verifyCallbackSignature(va: string, payload: Record<string, unknown>, signature: string | null): boolean {
  if (!signature || !va) return false
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(payload).sort()) {
    const v = payload[k]
    if (CALLBACK_INT_FIELDS.includes(k)) out[k] = Number(v)
    else if (k === 'is_escrow') out[k] = v === true || v === 'true' || v === '1' || v === 1
    else if (k === 'additional_info') { try { const p = typeof v === 'string' ? JSON.parse(v) : v; out[k] = Array.isArray(p) ? p : [] } catch { out[k] = [] } }
    else out[k] = v == null ? v : String(v)
  }
  if (!('additional_info' in out)) out.additional_info = []
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  const plain = JSON.stringify(sorted)
  const php = plain.replace(/\//g, '\\/')
  const phpFull = php.replace(/[\u0080-￿]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
  const got = Buffer.from(signature.trim().toLowerCase())
  for (const c of new Set([plain, php, phpFull])) {
    const want = Buffer.from(createHmac('sha256', va).update(c).digest('hex'))
    if (want.length === got.length && timingSafeEqual(want, got)) return true
  }
  return false
}

/** Callback iPaymu bawaan form-urlencoded (bisa JSON bila diubah di dasbor iPaymu). Kunci berulang/aneh diabaikan; hanya teks pendek. */
export function parseCallback(raw: string, contentType: string): Record<string, unknown> | null {
  try {
    if (contentType.includes('application/json')) {
      const v: unknown = JSON.parse(raw)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of new URLSearchParams(raw)) if (k.length <= 64 && !(k in out)) out[k] = v
    return out
  } catch { return null }
}
