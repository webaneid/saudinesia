import { routing } from '@/i18n/routing'
import { CHECKOUT_KINDS } from '@/lib/checkout/kinds'

// Jalur kembali sesudah login/daftar (docs/arsitektur-booking-engine-v2.md §10.5 butir 5). DAFTAR PUTIH, bukan daftar hitam: hanya halaman checkout
// satu produk persis berbentuk `/{locale}/checkout/{jenis}?id={uuid}` yang diterima — apa pun selain itu (alamat luar, `//`, `\`, skema, encoding,
// halaman admin, parameter lain) → null → dashboard. Dicocokkan atas teks MENTAH tanpa decode: karakter selain huruf/angka/`-` tak lolos sama sekali.
// Murni (tanpa I/O) — dipakai halaman server, route auth, dan penjaga tes.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PATTERN = new RegExp(`^/(${routing.locales.join('|')})/checkout/(${CHECKOUT_KINDS.join('|')})\\?id=${UUID}$`)
const MAX = 120

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
