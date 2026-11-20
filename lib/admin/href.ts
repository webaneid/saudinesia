// SATU-SATUNYA pembentuk alamat halaman admin (docs/rencana-domain-admin.md §3.1). Aman di server dan klien.
//
// Kode menulis jalur LOGIS `/admin/...` (sama dengan struktur folder `app/[locale]/admin/...`). Alamat yang dipakai browser bergantung mode:
// - mode jalur (`ADMIN_DOMAIN` kosong — dev lokal): `/{locale}/admin/...`, perilaku lama;
// - mode domain (`ADMIN_DOMAIN` terisi — produksi `admin.saudinesia.id`): `/...` tanpa awalan; middleware me-rewrite ke `/id/admin/...`.
// Di server mode dibaca dari env runtime (bukan NEXT_PUBLIC → satu image untuk domain apa pun). Di browser env itu tidak ada, jadi mode dibaca dari
// alamat yang sedang dibuka: halaman admin mode jalur selalu berawalan `/{locale}/admin`, mode domain tidak pernah — hasilnya sama dengan render
// server (tanpa selisih hidrasi). Dijaga scripts/test-admin-domain.ts (tautan admin tulisan tangan ditolak).

const ADMIN_PREFIX = /^\/admin(?=\/|$|\?|#)/
const PATH_MODE_URL = /^\/[a-z]{2}\/admin(?:\/|$)/i

/** Mode domain aktif? Server: `ADMIN_DOMAIN`; browser: alamat halaman admin saat ini. */
export function adminDomainMode(): boolean {
  if (typeof window === 'undefined') return Boolean(process.env.ADMIN_DOMAIN?.trim())
  return !PATH_MODE_URL.test(window.location.pathname)
}

/** Jalur logis `/admin/...` (boleh membawa `?query`/`#hash`) → alamat untuk `href`/`router.push`/`redirect`. */
export function adminHref(locale: string, path: string): string {
  if (!ADMIN_PREFIX.test(path)) throw new Error(`adminHref: jalur harus diawali /admin (${path})`)
  if (!adminDomainMode()) return `/${locale}${path}`
  const rest = path.replace(ADMIN_PREFIX, '')
  return rest === '' || rest.startsWith('?') || rest.startsWith('#') ? `/${rest}` : rest
}

/** Alamat browser halaman admin → jalur logis `/admin/...` (untuk breadcrumb/penanda menu). Tanpa query. */
export function adminLogicalPath(pathname: string): string {
  if (!adminDomainMode()) return pathname.replace(/^\/[^/]+(?=\/admin(?:\/|$))/, '')
  return pathname === '/' ? '/admin' : `/admin${pathname}`
}

/**
 * Tautan dari panel admin ke halaman PUBLIK (`/{locale}/...`). Mode domain: halaman publik ada di host app, jadi alamat absolut
 * `origin` (= `APP_URL`, diberikan server lewat `AdminPublicOrigin`); mode jalur: jalur relatif seperti biasa.
 */
export function publicHref(path: string, origin: string): string {
  if (!path.startsWith('/')) throw new Error(`publicHref: jalur harus diawali / (${path})`)
  return adminDomainMode() && origin ? `${origin}${path}` : path
}
