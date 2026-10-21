import { createHash } from 'node:crypto'
import { Redis } from 'ioredis'
import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'

// Rate limit untuk endpoint auth (docs/lessons-learned.md SEC-04). Counter jendela-tetap di Redis; bila Redis tidak
// terjangkau jatuh ke penyimpanan memori proses — aplikasi berjalan 1 replika (node-cron di dalam proses), jadi memori
// tetap melindungi (reset saat restart). Redis mati TIDAK berarti pembatasan hilang.

export type Policy = { key: string; limit: number; windowSec: number }
export type Hit = { allowed: boolean; count: number; limit: number; retryAfterSec: number }

/** Semua angka di satu tempat. Ubah di sini, bukan di route. */
export const LIMITS = {
  loginIp:        { limit: 20, windowSec: 900 },  // semua percobaan login dari satu IP
  loginAcctIp:    { limit: 5,  windowSec: 900 },  // GAGAL login per akun+IP
  loginAcct:      { limit: 30, windowSec: 3600 }, // GAGAL login per akun, dari mana pun (brute-force terdistribusi)
  otpSendPhone:   { limit: 3,  windowSec: 600 },  // OTP dikirim per nomor (spesifikasi CLAUDE.md)
  otpSendEmail:   { limit: 3,  windowSec: 600 },  // permintaan lupa-password per email
  otpSendIp:      { limit: 10, windowSec: 3600 }, // permintaan yang memicu OTP per IP
  otpVerifyPhone: { limit: 5,  windowSec: 900 },  // OTP SALAH per nomor — setelah ini OTP dibatalkan
  otpVerifyIp:    { limit: 30, windowSec: 600 },  // percobaan verifikasi OTP per IP
  resetIp:        { limit: 10, windowSec: 3600 }, // reset password per IP
} as const satisfies Record<string, { limit: number; windowSec: number }>

const MAX_ID_LENGTH = 128

export function policy(name: keyof typeof LIMITS, id: string): Policy {
  // Identitas berasal dari input pengguna (email/nomor tanpa batas panjang di skema) — identitas panjang di-hash
  // supaya kunci Redis/memori tidak bisa digelembungkan. Hash deterministik, jadi hitungan tetap konsisten.
  const safe = id.length > MAX_ID_LENGTH ? `sha256:${createHash('sha256').update(id).digest('hex')}` : id
  return { key: `rl:${name}:${safe}`, ...LIMITS[name] }
}

// Atomik: INCR + EXPIRE pada hit pertama + TTL. Cabang `ttl < 0` menyembuhkan kunci tanpa expiry (tidak boleh ada
// kunci yang menahan pengguna selamanya).
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {c, ttl}
`

const REDIS_COOLDOWN_MS = 10_000 // setelah gagal, jangan menunggu timeout Redis di tiap request
const MEMORY_MAX_KEYS = 50_000

let client: Redis | null | undefined
let redisDownUntil = 0
const memory = new Map<string, { count: number; resetAt: number }>()

function redis(): Redis | null {
  if (client !== undefined) return client
  const url = process.env.REDIS_URL
  if (!url) return (client = null)
  client = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 300, connectTimeout: 1000 })
  client.on('error', () => {}) // kegagalan ditangani per-perintah (fallback); tanpa listener ioredis mencetak tiap error
  return client
}

function devBypass(): boolean {
  // Hanya di development (fail-closed): RATE_LIMIT_DISABLED di lingkungan lain diabaikan.
  return process.env.NODE_ENV === 'development' && process.env.RATE_LIMIT_DISABLED === 'true'
}

function memoryHit(p: Policy, increment: boolean): Hit {
  const now = Date.now()
  if (memory.size > MEMORY_MAX_KEYS) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k)
    if (memory.size > MEMORY_MAX_KEYS) memory.clear() // banjir kunci: lebih baik mereset daripada menumbuhkan memori tanpa batas
  }
  let e = memory.get(p.key)
  if (!e || e.resetAt <= now) {
    if (!increment) return { allowed: true, count: 0, limit: p.limit, retryAfterSec: 0 }
    e = { count: 0, resetAt: now + p.windowSec * 1000 }
    memory.set(p.key, e)
  }
  if (increment) e.count++
  return { allowed: e.count <= p.limit, count: e.count, limit: p.limit, retryAfterSec: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) }
}

async function viaRedis<T>(run: (r: Redis) => Promise<T>): Promise<T | null> {
  const r = redis()
  if (!r || Date.now() < redisDownUntil) return null
  try {
    return await run(r)
  } catch {
    redisDownUntil = Date.now() + REDIS_COOLDOWN_MS
    return null
  }
}

/** Hitung satu percobaan. `allowed=false` bila sudah melewati batas. */
export async function consume(p: Policy): Promise<Hit> {
  if (devBypass()) return { allowed: true, count: 0, limit: p.limit, retryAfterSec: 0 }
  const res = await viaRedis((r) => r.eval(HIT_SCRIPT, 1, p.key, String(p.windowSec)) as Promise<[number, number]>)
  if (res) {
    const [count, ttl] = res
    return { allowed: count <= p.limit, count, limit: p.limit, retryAfterSec: Math.max(1, ttl) }
  }
  return memoryHit(p, true)
}

/** Lihat hitungan tanpa menambah (dipakai untuk "gagal per akun": dicek sebelum, dihitung hanya bila gagal). */
export async function peek(p: Policy): Promise<Hit> {
  if (devBypass()) return { allowed: true, count: 0, limit: p.limit, retryAfterSec: 0 }
  const res = await viaRedis(async (r) => {
    const [c, t] = await Promise.all([r.get(p.key), r.ttl(p.key)])
    return { count: c ? parseInt(c, 10) : 0, ttl: t }
  })
  if (res) return { allowed: res.count < p.limit, count: res.count, limit: p.limit, retryAfterSec: Math.max(1, res.ttl) }
  const m = memoryHit(p, false)
  return { ...m, allowed: m.count < p.limit }
}

export async function reset(...policies: Policy[]): Promise<void> {
  for (const p of policies) memory.delete(p.key)
  await viaRedis((r) => r.del(...policies.map((p) => p.key)))
}

/**
 * IP klien dari X-Forwarded-For. Caddy SELALU menimpa header ini dengan alamat yang benar-benar terhubung
 * (Caddyfile: header_up X-Forwarded-For {remote_host}), jadi nilainya tidak bisa dipalsukan klien. Tanpa header
 * (dev/direct) atau isinya bukan IP → null, dan pemanggil hanya memakai batas berbasis identitas.
 */
export function clientIp(request: Request): string | null {
  const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first && /^[0-9a-fA-F:.]{3,45}$/.test(first) ? first : null
}

export function tooManyRequests(retryAfterSec: number): NextResponse {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60))
  return NextResponse.json(err(`Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`), {
    status: 429,
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))) },
  })
}

/** Khusus pengujian: reset keadaan modul (singleton Redis & memori). */
export function __resetForTests(): void {
  memory.clear()
  redisDownUntil = 0
  client?.disconnect()
  client = undefined
}
