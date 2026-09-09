import createIntlMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { ADMIN_ROLES } from '@/lib/auth/session'

const LOCALES = ['id', 'en'] as const
const DEFAULT_LOCALE = 'id'
const COOKIE_NAME = 'snd-session'

const intlMiddleware = createIntlMiddleware({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
})

const PROTECTED       = ['/dashboard', '/bookings', '/groups', '/profile']
const ADMIN_PATHS     = ['/admin']
const PUBLIC_OVERRIDES = ['/admin/login']

async function getRole(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '')
    const { payload } = await jwtVerify(token, secret)
    return (payload as { role?: string }).role ?? null
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/api')) return NextResponse.next()

  const locale = LOCALES.find((l) => pathname.startsWith(`/${l}`)) ?? DEFAULT_LOCALE
  const pathWithoutLocale = pathname.replace(new RegExp(`^/${locale}`), '') || '/'

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
