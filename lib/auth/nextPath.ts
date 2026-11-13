import { routing } from '@/i18n/routing'
import { CHECKOUT_KINDS } from '@/lib/checkout/kinds'
import { PREFILL_KEYS } from '@/lib/checkout/prefill'

// Jalur kembali sesudah login/daftar (docs/arsitektur-booking-engine-v2.md §10.5 butir 5). DAFTAR PUTIH, bukan daftar hitam: hanya halaman checkout
// satu produk persis berbentuk `/{locale}/checkout/{jenis}?id={uuid}` (+ isian awal pesawat/hotel berpola sempit, urutan kanonik) dan halaman keranjang persis `/{locale}/keranjang` (§10.7) yang diterima — apa pun selain itu (alamat luar, `//`, `\`, skema, encoding,
// halaman admin, parameter lain) → null → dashboard. Dicocokkan atas teks MENTAH tanpa decode: karakter selain huruf/angka/`-` tak lolos sama sekali.
// Murni (tanpa I/O) — dipakai halaman server, route auth, dan penjaga tes.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const LOCALES = routing.locales.join('|')
const VALUE = { date: '\\d{4}-\\d{2}-\\d{2}', count: '[1-9]\\d{0,2}', uuid: UUID } as const
// Isian awal checkout (lib/checkout/prefill.ts): hanya kunci jenis itu, urutan kanonik, nilai berpola sempit (angka/tanggal/UUID) — tetap tanpa karakter lain.
const prefillOf = (keys: ReadonlyArray<readonly [string, keyof typeof VALUE]>) => keys.map(([k, v]) => `(&${k}=${VALUE[v]})?`).join('')
const CHECKOUT = CHECKOUT_KINDS.map(k => `${k}\\?id=${UUID}${k in PREFILL_KEYS ? prefillOf(PREFILL_KEYS[k as keyof typeof PREFILL_KEYS]) : ''}`).join('|')
const PATTERN = new RegExp(`^/(${LOCALES})/(checkout/(?:${CHECKOUT})|keranjang)$`)
const MAX = 200

export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX) return null
  return PATTERN.test(raw) ? raw : null
}

/** Tujuan sesudah autentikasi: jalur kembali yang sah, selain itu dashboard. */
export function afterAuthPath(locale: string, raw: unknown): string {
  return safeNextPath(raw) ?? `/${locale}/dashboard`
}

/** Menambahkan `?next=` ke jalur halaman auth bila jalur kembalinya sah; tidak pernah meneruskan nilai mentah. */
export function withNext(path: string, raw: unknown): string {
  const next = safeNextPath(raw)
  return next ? `${path}${path.includes('?') ? '&' : '?'}next=${encodeURIComponent(next)}` : path
}
