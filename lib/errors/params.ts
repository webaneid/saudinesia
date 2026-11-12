import { DATE_SHORT_MONTH, formatCalendarDate, isCalendarDate } from '@/lib/time'

// Parameter pesan galat API (docs/arsitektur-i18n-frontend.md §6.6) — murni, dipakai server (teks `id`) dan klien (bahasa halaman).
// Hanya data yang memang sudah tampil ke pemesan (nama produk, angka, tanggal kalender); TANPA data pribadi.

export type ApiErrorParams = Record<string, string | number>

/** Bentuk `meta` galat API: `code` = kunci `apiErrors.<code>`; `params` = nilai ICU; `field` = jalur kolom (bila ada). */
export type ApiErrorMeta = { code?: string; params?: ApiErrorParams; field?: string }

/** Parameter bernama `…Date` berisi tanggal kalender `YYYY-MM-DD` → diformat sesuai bahasa; selebihnya apa adanya. */
export function formatErrorParams(params: ApiErrorParams | undefined, locale: string): ApiErrorParams | undefined {
  if (!params) return undefined
  const out: ApiErrorParams = {}
  for (const [k, v] of Object.entries(params)) out[k] = k.endsWith('Date') && isCalendarDate(v) ? formatCalendarDate(v, DATE_SHORT_MONTH, locale) : v
  return out
}

/** Membaca `params` dari JSON tak tepercaya: hanya string/angka berhingga. */
export function readErrorParams(v: unknown): ApiErrorParams | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const out: ApiErrorParams = {}
  for (const [k, x] of Object.entries(v)) if (k !== '__proto__' && (typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)))) out[k] = x
  return out
}

const CODE_SHAPE = /^[a-z][a-zA-Z]{0,63}$/

/** Kode dari JSON tak tepercaya: bentuk kunci katalog (huruf saja) dan bukan nama warisan `Object.prototype` (`toString`, `constructor`…),
 *  yang bisa lolos `has` lewat prototipe. */
function isCatalogCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_SHAPE.test(code) && !(code in Object.prototype)
}

type Translate = { locale: string; defaultLocale: string; has: (code: string) => boolean; t: (code: string, params?: ApiErrorParams) => string }

/**
 * Aturan teks galat API di klien (murni; hook `useApiError`). Bahasa bawaan: teks server (selalu Indonesia, K1 — untuk galat berkode =
 * teks katalog `id`, kadang lebih rinci). Bahasa lain: kode dikenal (`meta.code`) → pesan `apiErrors.<kode>`; tanpa kode →
 * `fallback` formulir (keputusan I6-1) — tak pernah campur bahasa.
 */
export function resolveApiError(body: unknown, fallback: string, tr: Translate): string {
  const b = typeof body === 'object' && body !== null ? (body as { error?: unknown; meta?: unknown }) : {}
  if (tr.locale === tr.defaultLocale) return typeof b.error === 'string' && b.error !== '' ? b.error : fallback
  const meta = typeof b.meta === 'object' && b.meta !== null ? (b.meta as { code?: unknown; params?: unknown }) : {}
  if (isCatalogCode(meta.code) && tr.has(meta.code)) return tr.t(meta.code, formatErrorParams(readErrorParams(meta.params), tr.locale))
  return fallback
}
