import createIntlMiddleware from 'next-intl/middleware'
import { routing } from '@/i18n/routing'
import { type NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
// roles (bukan session): session.ts memakai Prisma, tidak boleh ikut ke bundel Edge. Middleware hanya gerbang kasar — keputusan akses ada di getSession().
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { canonicalGatePath } from '@/lib/auth/gatePath'
import { apiBlockedOnHost, hostKind } from '@/lib/admin/domain'

const LOCALES = routing.locales
const DEFAULT_LOCALE = routing.defaultLocale
const COOKIE_NAME = 'snd-session'

const intlMiddleware = createIntlMiddleware(routing)

const PROTECTED       = ['/dashboard', '/bookings', '/profile', '/lengkapi-data']
const ADMIN_PATHS     = ['/admin']
const PUBLIC_OVERRIDES = ['/admin/login']

async function getRole(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '')
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    return (payload as { role?: string }).role ?? null
  } catch {
    return null
  }
}

const notFound = (api: boolean) => api
  ? NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  : new NextResponse('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })

// Halaman admin di jalur `/{locale}/admin…` (bentuk lama/mode satu host). Locale dicocokkan tanpa membedakan huruf, seperti next-intl.
function legacyAdminRest(pathname: string): string | null {
  const m = /^\/([^/]+)\/admin(\/.*)?$/.exec(pathname)
  if (!m || !LOCALES.some((l) => l === m[1]!.toLowerCase())) return null
  return m[2] ?? '/'
}

/**
 * Host admin (`ADMIN_DOMAIN`, docs/rencana-domain-admin.md §3.2): alamat ramah `/X` di-REWRITE ke `/id/admin/X` (URL browser tetap `/X`);
 * bentuk lama `/{locale}/admin/X` → 308 ke `/X` (K4); halaman publik berlocale → 404. Gerbang role sama dengan mode satu host.
 */
async function adminHost(request: NextRequest, pathname: string) {
  const legacy = legacyAdminRest(pathname)
  if (legacy !== null) return NextResponse.redirect(new URL(`${legacy}${request.nextUrl.search}`, request.url), 308)
  const first = (pathname.split('/')[1] ?? '').toLowerCase()
  if (LOCALES.some((l) => l === first)) return notFound(false)
  // Segmen `.`/`..` (mis. `%2e%2e` yang baru terdekode di sini) akan dinormalkan URL tujuan rewrite keluar dari `/id/admin` — tolak.
  if (pathname.split('/').some((seg) => seg === '.' || seg === '..')) return notFound(false)

  const isLogin = pathname === '/login'
  if (!isLogin) {
    const role = await getRole(request)
    if (!role || !ADMIN_ROLES.includes(role as never)) return NextResponse.redirect(new URL('/login', request.url))
  }
  const target = new URL(`/${DEFAULT_LOCALE}/admin${pathname === '/' ? '' : pathname}${request.nextUrl.search}`, request.url)
  // Locale untuk next-intl (`requestLocale`) — biasanya dipasang middleware next-intl, yang tidak dilewati di host admin.
  const headers = new Headers(request.headers)
  headers.set('X-NEXT-INTL-LOCALE', DEFAULT_LOCALE)
  return NextResponse.rewrite(target, { request: { headers } })
}

export async function middleware(request: NextRequest) {
  const pathname = canonicalGatePath(request.nextUrl.pathname)
  const kind = hostKind(request.headers.get('host'))

  if (pathname.startsWith('/api')) return apiBlockedOnHost(kind, pathname) ? notFound(true) : NextResponse.next()
  if (kind === 'admin') return adminHost(request, pathname)
  // Host app (K3): panel admin tidak ada di sini — 404, tanpa mengiklankan alamat host admin.
  if (kind === 'app' && (legacyAdminRest(pathname) !== null || /^\/admin(?:\/|$)/.test(pathname))) return notFound(false)

  // Locale = segmen pertama PERSIS (tanpa membedakan huruf besar/kecil, seperti next-intl): `/idadmin` bukan locale `id`, `/ID/admin` adalah `id`.
  const first = pathname.split('/')[1] ?? ''
  const matched = LOCALES.find((l) => l === first.toLowerCase())
  const locale = matched ?? DEFAULT_LOCALE
  const pathWithoutLocale = matched ? pathname.slice(first.length + 1) || '/' : pathname

  const isPublicOverride = PUBLIC_OVERRIDES.some((r) => pathWithoutLocale.startsWith(r))
  const needsAuth  = !isPublicOverride && PROTECTED.some((r) => pathWithoutLocale.startsWith(r))
  const needsAdmin = !isPublicOverride && ADMIN_PATHS.some((r) => pathWithoutLocale.startsWith(r))

  if (needsAuth || needsAdmin) {
    const role = await getRole(request)
    if (!role) {
      const redirectTo = needsAdmin ? `/${locale}/admin/login` : `/${locale}/login`
      return NextResponse.redirect(new URL(redirectTo, request.url))
    }
    if (needsAdmin && !ADMIN_ROLES.includes(role as never)) {
      return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url))
    }
  }

  return intlMiddleware(request)
}

export const config = {
  // Entri kedua: token invoice publik berisi titik (`<id>.<mac>`) sehingga lolos dari entri pertama (pengecualian berkas aset) — tanpa middleware,
  // `getLocale()`/`useLocale()` jatuh ke bawaan dan `<html lang>`/pengalih bahasa salah di /en/invoice (docs/arsitektur-i18n-frontend.md §6.5).
  // Entri ketiga: SEMUA /api (juga yang berisi titik) — penolakan API per host (docs/rencana-domain-admin.md §3.3) tak boleh dilewati lewat
  // jalur bertitik. Selain penolakan itu API tetap diteruskan apa adanya.
  matcher: ['/((?!_next|.*\\..*).*)', '/([^/_][^/]*)/invoice/([^/]+)', '/api/:path*'],
}
