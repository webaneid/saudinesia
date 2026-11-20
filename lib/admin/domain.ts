// Murni (tanpa I/O, tanpa Node API) — aman untuk bundel Edge middleware. docs/rencana-domain-admin.md §3.2–3.5.
//
// `ADMIN_DOMAIN` (env runtime) terisi = admin dilayani di host sendiri (`admin.saudinesia.id`), situs publik di host lain (`app.`).
// Kosong = satu host (dev lokal): perilaku lama `/{locale}/admin`.

export type HostKind = 'single' | 'admin' | 'app'

/** Nama host tanpa port, huruf kecil. */
export function bareHost(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

export function configuredAdminDomain(): string {
  return bareHost(process.env.ADMIN_DOMAIN)
}

export function hostKind(host: string | null | undefined): HostKind {
  const admin = configuredAdminDomain()
  if (!admin) return 'single'
  return bareHost(host) === admin ? 'admin' : 'app'
}

/** API yang tidak dilayani host app (panel admin hanya di host admin). */
export const APP_HOST_BLOCKED_API = ['/api/v1/admin']
/** API khusus jamaah/pihak luar yang tidak dilayani host admin (daftar, Google, webhook — semuanya beralamat `APP_URL`). */
export const ADMIN_HOST_BLOCKED_API = ['/api/v1/auth/google', '/api/v1/auth/register', '/api/v1/auth/registration', '/api/v1/webhooks']

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

export function apiBlockedOnHost(kind: HostKind, path: string): boolean {
  if (kind === 'app') return APP_HOST_BLOCKED_API.some(p => under(path, p))
  if (kind === 'admin') return ADMIN_HOST_BLOCKED_API.some(p => under(path, p))
  return false
}

/**
 * K2: sesi staf hanya terbit di host admin, sesi jamaah hanya di host app (cookie host-only — sesi yang terbit di host yang salah tak
 * berguna dan membingungkan). Dinilai SESUDAH password terbukti benar (tak membocorkan peran ke penebak).
 */
export function loginHostRefusal(kind: HostKind, staff: boolean): 'staffUseAdminDomain' | 'adminDomainStaffOnly' | null {
  if (kind === 'app' && staff) return 'staffUseAdminDomain'
  if (kind === 'admin' && !staff) return 'adminDomainStaffOnly'
  return null
}
