import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { requirePiiKeys } from './keys'

// Enkripsi & indeks PII (docs/arsitektur-jamaah.md §6). SATU-SATUNYA pemakai cipher di aplikasi (dijaga scripts/test-pii.ts).
// Ciphertext: `v<versi>.<iv base64url>.<ciphertext+tag base64url>` — AES-256-GCM, IV 12 byte acak per nilai, tag 16 byte.
// AAD = tujuan ('nik' | 'passport'): ciphertext NIK yang dipindah ke kolom paspor (atau sebaliknya) gagal dibuka.

export type PiiPurpose = 'nik' | 'passport'

const IV_BYTES = 12
const TAG_BYTES = 16
const CIPHER_RE = /^v([1-9]\d{0,5})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/
const aad = (purpose: PiiPurpose) => Buffer.from(`saudinesia-pii:${purpose}`)

/** Galat dekripsi tanpa isi data (ciphertext rusak, kunci versi tak dikenal, atau tag tak cocok). */
export class PiiDecryptError extends Error {
  constructor(reason: string) { super(`PII tidak bisa dibuka: ${reason}`); this.name = 'PiiDecryptError' }
}

export function encryptPii(purpose: PiiPurpose, plaintext: string): string {
  if (plaintext.length === 0) throw new RangeError('Nilai PII kosong tidak dienkripsi')
  const { encryption } = requirePiiKeys()
  const iv = randomBytes(IV_BYTES)
  const c = createCipheriv('aes-256-gcm', encryption.key, iv, { authTagLength: TAG_BYTES })
  c.setAAD(aad(purpose))
  const body = Buffer.concat([c.update(plaintext, 'utf8'), c.final(), c.getAuthTag()])
  return `v${encryption.version}.${iv.toString('base64url')}.${body.toString('base64url')}`
}

export function decryptPii(purpose: PiiPurpose, sealed: string): string {
  const m = CIPHER_RE.exec(sealed)
  if (!m) throw new PiiDecryptError('bentuk tidak dikenal')
  const version = Number(m[1])
  const keys = requirePiiKeys()
  const key = version === keys.encryption.version ? keys.encryption.key : keys.retired.get(version)
  if (!key) throw new PiiDecryptError(`kunci versi ${version} tidak tersedia`)
  const iv = Buffer.from(m[2]!, 'base64url')
  const body = Buffer.from(m[3]!, 'base64url')
  if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) throw new PiiDecryptError('bentuk tidak dikenal')
  try {
    const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    d.setAAD(aad(purpose))
    d.setAuthTag(body.subarray(body.length - TAG_BYTES))
    return Buffer.concat([d.update(body.subarray(0, body.length - TAG_BYTES)), d.final()]).toString('utf8')
  } catch {
    throw new PiiDecryptError('autentikasi gagal')
  }
}

/** Ciphertext ditulis dengan kunci yang bukan kunci tulis sekarang → perlu dienkripsi ulang (rotasi). */
export function needsReencrypt(sealed: string): boolean {
  const m = CIPHER_RE.exec(sealed)
  return !m || Number(m[1]) !== requirePiiKeys().encryption.version
}

/** Indeks deterministik untuk keunikan/pencarian: HMAC-SHA256 berkunci (hex). Hash polos dapat dibalik karena ruang NIK kecil dan berpola. */
export function piiIndex(purpose: PiiPurpose, normalized: string): string {
  return createHmac('sha256', requirePiiKeys().index).update(`${purpose}:${normalized}`).digest('hex')
}

/** Bandingkan dua indeks hex tanpa kebocoran waktu; bentuk berbeda = tidak sama. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
