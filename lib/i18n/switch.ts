import { routing, type AppLocale } from '@/i18n/routing'

// Satu-satunya pembangun alamat pengalih bahasa (docs/arsitektur-i18n-frontend.md §3.1): halaman yang SAMA (path + query) di locale lain.
// Murni — dipakai `LocaleSwitcher` (klien) dan diuji `scripts/test-i18n-coverage.ts`. Hasil SELALU path relatif berawalan `/{locale}`:
// tak pernah alamat luar atau scheme-relative (`//host`), apa pun isi path/query masukan.

const isLocale = (v: string): v is AppLocale => (routing.locales as readonly string[]).includes(v)

/** Path `pathname` (dengan atau tanpa awalan locale) + `search` (dengan/tanpa `?`) dipindah ke locale `to`. */
export function switchLocalePath(pathname: string, search: string, to: AppLocale): string {
  // Hanya bagian path: buang skema/host bila ada, buang query/fragmen yang terselip, rapatkan garis miring ganda.
  const path = (pathname.startsWith('/') ? pathname : `/${pathname}`).split(/[?#]/)[0]!.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  const segments = path.split('/').filter(Boolean)
  if (segments[0] && isLocale(segments[0].toLowerCase())) segments.shift()
  const rest = segments.length > 0 ? `/${segments.join('/')}` : ''
  const query = swapNextLocale(search.replace(/^\?/, ''), to)
  return `/${to}${rest}${query ? `?${query}` : ''}`
}

/**
 * Jalur kembali `next` (halaman masuk/daftar → checkout) ikut pindah bahasa, supaya sesudah masuk pengguna tak dilempar ke bahasa lama.
 * Hanya awalan locale dari path RELATIF (`/id/…`) yang diganti; nilai lain dibiarkan apa adanya — server tetap menyaringnya (`safeNextPath`).
 */
function swapNextLocale(query: string, to: AppLocale): string {
  if (!query) return query
  const params = new URLSearchParams(query)
  const next = params.get('next')
  const m = next ? /^\/([^/?#]+)(?=$|[/?#])/.exec(next) : null
  if (!next || !m || !isLocale(m[1]!.toLowerCase()) || m[1] === to) return query
  params.set('next', `/${to}${next.slice(m[0].length)}`)
  return params.toString()
}

/** Locale dari segmen pertama path; bukan locale dikenal → bawaan. */
export function localeOfPath(pathname: string): AppLocale {
  const first = pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? ''
  return isLocale(first) ? first : routing.defaultLocale
}

/** Nama tiap bahasa DALAM bahasanya sendiri (sama di semua locale — konvensi pengalih bahasa), kode pendek untuk tombol. */
export const LOCALE_LABEL: Record<AppLocale, { short: string; name: string }> = {
  id: { short: 'ID', name: 'Bahasa Indonesia' },
  en: { short: 'EN', name: 'English' },
}
