import createIntlMiddleware from 'next-intl/middleware'
import { routing } from '@/i18n/routing'
import { type NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
// roles (bukan session): session.ts memakai Prisma, tidak boleh ikut ke bundel Edge. Middleware hanya gerbang kasar — keputusan akses ada di getSession().
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { canonicalGatePath } from '@/lib/auth/gatePath'

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

export async function middleware(request: NextRequest) {
  const pathname = canonicalGatePath(request.nextUrl.pathname)

  if (pathname.startsWith('/api')) return NextResponse.next()

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
  matcher: ['/((?!_next|.*\\..*).*)'],
}
