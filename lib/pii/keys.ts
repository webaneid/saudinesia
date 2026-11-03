import { createHash } from 'node:crypto'

// Kunci data pribadi sensitif (NIK, nomor paspor) — docs/arsitektur-jamaah.md §6, ADR-0005. Terpisah dari JWT_SECRET: merotasi kunci sesi tak boleh
// merusak indeks NIK atau membuat NIK tersimpan tak terbaca. Dibaca saat dipakai (fail-closed) — modul lain memakai lib/pii, bukan env ini.
//   PII_INDEX_KEY                 64 hex — kunci HMAC indeks pencarian/dedup (tidak berversi: mengganti = menghitung ulang semua indeks)
//   PII_ENCRYPTION_KEY            64 hex — kunci AES-256-GCM yang dipakai MENULIS
//   PII_ENCRYPTION_KEY_VERSION    bilangan bulat ≥ 1 (bawaan 1) — tertulis di setiap ciphertext
//   PII_ENCRYPTION_KEYS_RETIRED   opsional, "versi:hex,versi:hex" — kunci lama yang hanya dipakai MEMBACA (rotasi)

const HEX_KEY = /^[0-9a-f]{64}$/
const MIN_DISTINCT_HEX = 8 // 'aaaa…'/'0123012301…' bukan kunci acak

export type PiiKeys = { index: Buffer; encryption: { version: number; key: Buffer }; retired: ReadonlyMap<number, Buffer> }

function hexKeyProblem(name: string, raw: string | undefined): string | null {
  if (!raw) return `${name} belum diisi — buat dengan: openssl rand -hex 32`
  const v = raw.trim().toLowerCase()
  if (!HEX_KEY.test(v)) return `${name} harus 64 karakter hex (32 byte) — buat dengan: openssl rand -hex 32`
  if (new Set(v).size < MIN_DISTINCT_HEX || repeatsBlock(v)) return `${name} entropi terlalu rendah — buat dengan: openssl rand -hex 32`
  return null
}

/** Tersusun dari satu blok ≤ 16 karakter yang diulang ('0123456789abcdef' × 4, 'deadbeef' × 8). */
const repeatsBlock = (v: string) => [1, 2, 4, 8, 16].some(n => v === v.slice(0, n).repeat(v.length / n))

const fingerprint = (key: Buffer) => createHash('sha256').update(key).digest('hex')

/** Periksa konfigurasi kunci tanpa melempar; `null` = sah. Pesan tidak pernah memuat nilai kunci. */
export function piiKeysProblem(env: Record<string, string | undefined> = process.env): string | null {
  return parse(env).problem
}

function parse(env: Record<string, string | undefined>): { problem: string; keys?: never } | { problem: null; keys: PiiKeys } {
  const fail = (problem: string) => ({ problem })
  const p1 = hexKeyProblem('PII_INDEX_KEY', env.PII_INDEX_KEY) ?? hexKeyProblem('PII_ENCRYPTION_KEY', env.PII_ENCRYPTION_KEY)
  if (p1) return fail(p1)
  const index = Buffer.from(env.PII_INDEX_KEY!.trim().toLowerCase(), 'hex')
  const encKey = Buffer.from(env.PII_ENCRYPTION_KEY!.trim().toLowerCase(), 'hex')
  if (index.equals(encKey)) return fail('PII_INDEX_KEY dan PII_ENCRYPTION_KEY harus berbeda')
  const jwt = env.JWT_SECRET?.trim().toLowerCase()
  if (jwt && (jwt === env.PII_INDEX_KEY!.trim().toLowerCase() || jwt === env.PII_ENCRYPTION_KEY!.trim().toLowerCase())) return fail('Kunci PII tidak boleh sama dengan JWT_SECRET')

  const versionRaw = env.PII_ENCRYPTION_KEY_VERSION?.trim() || '1'
  if (!/^[1-9]\d{0,5}$/.test(versionRaw)) return fail('PII_ENCRYPTION_KEY_VERSION harus bilangan bulat ≥ 1')
  const version = Number(versionRaw)

  const retired = new Map<number, Buffer>()
  const seen = new Set([fingerprint(index), fingerprint(encKey)])
  if (jwt && HEX_KEY.test(jwt)) seen.add(fingerprint(Buffer.from(jwt, 'hex'))) // kunci pensiun juga tak boleh = JWT_SECRET
  for (const entry of (env.PII_ENCRYPTION_KEYS_RETIRED ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^([1-9]\d{0,5}):(.+)$/.exec(entry)
    if (!m) return fail('PII_ENCRYPTION_KEYS_RETIRED harus berbentuk "versi:hex,versi:hex"')
    const v = Number(m[1])
    const problem = hexKeyProblem(`PII_ENCRYPTION_KEYS_RETIRED (versi ${v})`, m[2])
    if (problem) return fail(problem)
    if (v === version || retired.has(v)) return fail(`Versi kunci ${v} ganda di PII_ENCRYPTION_KEYS_RETIRED`)
    const key = Buffer.from(m[2]!.trim().toLowerCase(), 'hex')
    if (seen.has(fingerprint(key))) return fail(`Kunci versi ${v} di PII_ENCRYPTION_KEYS_RETIRED sama dengan kunci lain`)
    seen.add(fingerprint(key))
    retired.set(v, key)
  }
  return { problem: null, keys: { index, encryption: { version, key: encKey }, retired } }
}

let cache: { sig: string; keys: PiiKeys } | null = null

/** Kunci yang sudah divalidasi; melempar bila kosong/lemah/salah bentuk. Di-cache per isi env (tes boleh mengganti env). */
export function requirePiiKeys(env: Record<string, string | undefined> = process.env): PiiKeys {
  const sig = [env.PII_INDEX_KEY, env.PII_ENCRYPTION_KEY, env.PII_ENCRYPTION_KEY_VERSION, env.PII_ENCRYPTION_KEYS_RETIRED, env.JWT_SECRET].join('\u0000')
  if (cache && cache.sig === sig) return cache.keys
  const parsed = parse(env)
  if (parsed.problem !== null) throw new Error(parsed.problem)
  cache = { sig, keys: parsed.keys }
  return parsed.keys
}

/** Peringatan saat boot (instrumentation): tidak menjatuhkan server — fitur jamaah gagal-tertutup saat dipakai. */
export function warnPiiKeysOnBoot(): void {
  const problem = piiKeysProblem()
  if (problem) console.error(`[pii] ${problem}. Fitur data jamaah (NIK/paspor) akan menolak bekerja sampai diperbaiki.`)
}
