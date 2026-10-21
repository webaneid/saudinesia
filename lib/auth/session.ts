import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import type { UserRole } from '@prisma/client'

const COOKIE_NAME = 'snd-session'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export type SessionPayload = {
  userId: string
  role: UserRole  // sourced from Prisma — auto-updates when enum changes
}

// Role hierarchy helpers — didefinisikan di ./roles (client-safe), di-re-export agar import lama tetap jalan
import { ADMIN_ROLES, MANAGER_ROLES, SUPERADMIN_ROLES } from './roles'
export { ADMIN_ROLES, MANAGER_ROLES, SUPERADMIN_ROLES }

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret())

  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
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
