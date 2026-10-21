import { randomBytes } from 'node:crypto'
import { hash } from 'bcryptjs'
import { Prisma } from '@prisma/client'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/db'
import { PRIVACY_POLICY_VERSION } from '@/lib/constants/legal'
import type { GoogleIdentity } from '@/lib/auth/google'

// Akun untuk login Google (docs/arsitektur-auth.md §3.3). Hanya DB — tanpa HTTP/sesi — supaya aturan keamanannya bisa diuji langsung.

export type GoogleResolution =
  | { kind: 'session'; user: { id: string; role: UserRole } }
  | { kind: 'new' }
  | { kind: 'refused'; reason: 'staff' | 'inactive' | 'conflict' }

/** Hash dari 32 byte acak yang tak pernah disimpan: akun Google-only tak punya password yang bisa ditebak. */
const unusablePasswordHash = () => hash(randomBytes(32).toString('hex'), 12)

export async function resolveGoogleLogin(identity: GoogleIdentity): Promise<GoogleResolution> {
  // 1. Sudah pernah tersambung — `sub` adalah kunci yang stabil (email bisa berubah di sisi Google).
  const bySub = await prisma.user.findUnique({ where: { googleSub: identity.sub }, select: { id: true, role: true, isActive: true } })
  if (bySub) {
    if (bySub.role !== 'pilgrim') return { kind: 'refused', reason: 'staff' }
    if (!bySub.isActive) return { kind: 'refused', reason: 'inactive' }
    return { kind: 'session', user: { id: bySub.id, role: bySub.role } }
  }

  // 2. Email sama dengan akun yang ada → sambung otomatis. Aman karena Google SUDAH memverifikasi email ini (ID token
  //    email_verified), dan akun manual hanya lahir setelah pemilik email membuktikan kepemilikan.
  const byEmail = await prisma.user.findUnique({ where: { email: identity.email }, select: { id: true, role: true, isActive: true, googleSub: true, emailVerifiedAt: true } })
  if (!byEmail) return { kind: 'new' }
  if (byEmail.role !== 'pilgrim') return { kind: 'refused', reason: 'staff' } // staf hanya password — Google tak pernah jadi jalan masuk admin
  if (!byEmail.isActive) return { kind: 'refused', reason: 'inactive' }
  if (byEmail.googleSub && byEmail.googleSub !== identity.sub) return { kind: 'refused', reason: 'conflict' }

  // Akun lama yang belum terverifikasi (pra-Fase 1): password-nya tidak dipercaya lagi — bisa saja dipasang pihak lain.
  const legacyUnverified = !byEmail.emailVerifiedAt
  const passwordHash = legacyUnverified ? await unusablePasswordHash() : undefined
  // Klaim atomik: hanya satu pemanggil yang menyambung akun yang googleSub-nya masih kosong.
  const linked = await prisma.user.updateMany({
    where: { id: byEmail.id, googleSub: null },
    data: { googleSub: identity.sub, ...(legacyUnverified ? { emailVerifiedAt: new Date(), passwordHash } : {}) },
  })
  if (linked.count === 0) {
    const again = await prisma.user.findUnique({ where: { id: byEmail.id }, select: { googleSub: true } })
    if (again?.googleSub !== identity.sub) return { kind: 'refused', reason: 'conflict' }
  }
  return { kind: 'session', user: { id: byEmail.id, role: byEmail.role } }
}

export type GoogleSignup = { ok: true; user: { id: string; role: UserRole; email: string; fullName: string } } | { ok: false; reason: 'exists' }

/** Pengguna baru: dipanggil SETELAH ia menyetujui kebijakan privasi di halaman lengkapi (UU PDP — persetujuan sebelum akun ada). */
export async function createGoogleAccount(identity: GoogleIdentity, fullName: string): Promise<GoogleSignup> {
  const passwordHash = await unusablePasswordHash()
  try {
    const user = await prisma.user.create({
      data: {
        email: identity.email, passwordHash, fullName, role: 'pilgrim', isActive: true,
        emailVerifiedAt: new Date(), googleSub: identity.sub,
        consentLogs: { create: { type: 'privacy_policy', version: PRIVACY_POLICY_VERSION } },
      },
      select: { id: true, role: true, email: true, fullName: true },
    })
    return { ok: true, user }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, reason: 'exists' }
    throw e
  }
}
