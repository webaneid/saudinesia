import { cache } from 'react'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { cookies } from 'next/headers'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/db'
import { SESSION_SAME_SITE, cookieSecure } from '@/lib/auth/cookieFlags'
import { requireJwtSecret } from '@/lib/auth/secret'

const COOKIE_NAME = 'snd-session'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

function getSecret(): Uint8Array {
  return new TextEncoder().encode(requireJwtSecret())
}

/** Sesi yang SUDAH divalidasi ke DB: `role` selalu dari DB (bukan dari token), jadi perubahan peran berlaku seketika. */
export type SessionPayload = {
  userId: string
  role: UserRole  // sourced from Prisma — auto-updates when enum changes
}

// Role hierarchy helpers — didefinisikan di ./roles (client-safe), di-re-export agar import lama tetap jalan
import { ADMIN_ROLES, MANAGER_ROLES, SUPERADMIN_ROLES } from './roles'
export { ADMIN_ROLES, MANAGER_ROLES, SUPERADMIN_ROLES }

/**
 * Menerbitkan sesi untuk `userId`. Peran & versi sesi dibaca dari DB di sini — pemanggil tidak bisa menyodorkan peran/versi basi.
 * Token membawa `ver` (= User.sessionVersion saat terbit) supaya bisa dicabut dari server (SEC-18, docs/arsitektur-auth.md §11).
 * `role` di token hanya petunjuk kasar untuk middleware (Edge, tanpa DB); keputusan akses selalu lewat resolveSessionToken().
 */
/**
 * `expectedVersion`: versi yang dilihat pemanggil saat MEMVERIFIKASI kredensial (mis. login membaca user, lalu bcrypt ±250 ms). Bila
 * `sessionVersion` berubah di antaranya (reset password commit di celah itu) token TIDAK diterbitkan — kalau tidak, password lama yang baru saja
 * dicabut mendapat token ber-versi baru yang lolos pencabutan (race login-vs-reset, S18-B).
 */
export async function issueSessionToken(userId: string, expectedVersion?: number): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, sessionVersion: true, isActive: true, emailVerifiedAt: true },
  })
  if (!user || !user.isActive || !user.emailVerifiedAt) throw new Error('Unauthorized')
  if (expectedVersion !== undefined && user.sessionVersion !== expectedVersion) throw new Error('Unauthorized')

  return new SignJWT({ userId, role: user.role, ver: user.sessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret())
}

export async function createSession(userId: string, expectedVersion?: number): Promise<void> {
  const token = await issueSessionToken(userId, expectedVersion)
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: SESSION_SAME_SITE, // Lax — lihat lib/auth/cookieFlags.ts (Strict merusak login Google & tautan dari email)
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
}

// Satu kueri per pengguna per request (layout + halaman memanggil getSession() bersamaan). Di luar RSC (skrip uji) `cache` hanya meneruskan.
const loadSessionUser = cache((userId: string) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, emailVerifiedAt: true, sessionVersion: true },
  }),
)

/**
 * Tanda tangan/kedaluwarsa JWT saja TIDAK cukup (SEC-18): token valid ditolak bila akun sudah tak ada, dinonaktifkan, belum
 * terbukti emailnya, atau `ver` token ≠ User.sessionVersion (password direset, peran diubah, dicabut). Token tanpa `ver`
 * (terbit sebelum fitur ini) ditolak — fail-closed. Peran dikembalikan dari DB.
 */
export async function resolveSessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null
  let claims: JWTPayload
  try {
    claims = (await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })).payload
  } catch {
    return null
  }
  if (typeof claims.userId !== 'string' || typeof claims.ver !== 'number') return null

  const user = await loadSessionUser(claims.userId)
  if (!user || !user.isActive || !user.emailVerifiedAt || user.sessionVersion !== claims.ver) return null
  return { userId: claims.userId, role: user.role }
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies()
  return resolveSessionToken(jar.get(COOKIE_NAME)?.value)
}

export async function clearSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  return session
}

/** admin | manager | superadmin */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession()
  if (!ADMIN_ROLES.includes(session.role)) throw new Error('Forbidden')
  return session
}

/** manager | superadmin — can manage products */
export async function requireManager(): Promise<SessionPayload> {
  const session = await requireSession()
  if (!MANAGER_ROLES.includes(session.role)) throw new Error('Forbidden')
  return session
}

/** superadmin only */
export async function requireSuperAdmin(): Promise<SessionPayload> {
  const session = await requireSession()
  if (!SUPERADMIN_ROLES.includes(session.role)) throw new Error('Forbidden')
  return session
}
