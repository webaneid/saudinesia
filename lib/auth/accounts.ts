import { hash } from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { claimToken, issueToken, peekToken } from '@/lib/auth/tokens'
import { PRIVACY_POLICY_VERSION, WHATSAPP_CONSENT_VERSION } from '@/lib/constants/legal'
import { registrationPayloadSchema, type RegisterInput } from '@/lib/validators/auth'
import type { UserRole } from '@prisma/client'

// Logika akun TANPA HTTP/sesi/rate limit (route yang mengurus itu) supaya bisa diuji langsung terhadap database.
// docs/arsitektur-auth.md §3.2.

const BCRYPT_COST = 12

// ───────────── Pendaftaran manual ─────────────

export type RegistrationRequest =
  | { kind: 'pending'; token: string }
  | { kind: 'already_registered'; fullName: string }

/**
 * Pendaftaran BELUM membuat akun. Isian disimpan di token; akun lahir di completeRegistration() saat pemilik email mengklik
 * tautan dan memilih password. Karena itu tidak ada akun setengah jadi yang password-nya bisa dipasang orang lain.
 */
export async function requestRegistration(input: RegisterInput): Promise<RegistrationRequest> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { fullName: true } })
  if (existing) return { kind: 'already_registered', fullName: existing.fullName }

  const token = await issueToken({
    type: 'registration',
    email: input.email,
    payload: { fullName: input.fullName, phone: input.phone, whatsapp: input.whatsapp },
  })
  return { kind: 'pending', token }
}

export type RegistrationPreview = { email: string; fullName: string; phone: string; whatsapp: string }

/** Untuk halaman tautan: tampilkan isian agar pemilik email bisa mengenali pendaftaran itu miliknya. Tidak mengonsumsi token. */
export async function previewRegistration(rawToken: string): Promise<RegistrationPreview | null> {
  const t = await peekToken(rawToken, 'registration')
  const payload = t ? registrationPayloadSchema.safeParse(t.payload) : null
  if (!t?.email || !payload?.success) return null
  return { email: t.email, fullName: payload.data.fullName, phone: payload.data.phone, whatsapp: payload.data.whatsapp }
}

export type CompleteResult =
  | { ok: true; user: { id: string; role: UserRole; fullName: string; email: string } }
  | { ok: false; reason: 'invalid' | 'exists' }

export async function completeRegistration(rawToken: string, password: string): Promise<CompleteResult> {
  // Cek murah dulu (tanpa mengonsumsi) agar hash bcrypt yang mahal tidak dijalankan untuk token ngawur.
  if (!(await peekToken(rawToken, 'registration'))) return { ok: false, reason: 'invalid' }
  const passwordHash = await hash(password, BCRYPT_COST)

  try {
    return await prisma.$transaction(async (tx) => {
      const t = await claimToken(tx, rawToken, 'registration')
      const payload = t ? registrationPayloadSchema.safeParse(t.payload) : null
      if (!t?.email || !payload?.success) return { ok: false as const, reason: 'invalid' as const }

      // Persetujuan dicatat SEKARANG, oleh pemilik email yang mengklik tautan — bukan pada waktu pengirim form mengisi.
      const user = await tx.user.create({
        data: {
          email: t.email,
          passwordHash,
          fullName: payload.data.fullName,
          phone: payload.data.phone,
          whatsapp: payload.data.whatsapp,
          role: 'pilgrim',
          isActive: true,
          emailVerifiedAt: new Date(),
          consentLogs: {
            create: [
              { type: 'privacy_policy', version: PRIVACY_POLICY_VERSION },
              { type: 'whatsapp_notifications', version: WHATSAPP_CONSENT_VERSION },
            ],
          },
        },
        select: { id: true, role: true, fullName: true, email: true },
      })
      // Minimalisasi data (UU PDP): isian milik pihak yang mungkin tak pernah jadi pengguna tidak disimpan lebih lama dari perlu.
      await tx.authToken.update({ where: { id: t.id }, data: { payload: Prisma.DbNull } })
      return { ok: true as const, user }
    })
  } catch (e) {
    // Dua tautan untuk email yang sama diselesaikan bersamaan / akun sudah dibuat lewat jalur lain (mis. Google): transaksi di-rollback.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, reason: 'exists' }
    throw e
  }
}

// ───────────── Reset password ─────────────

export type ResetRequest = { kind: 'send'; token: string; fullName: string } | { kind: 'none' }

/** Hanya akun aktif yang mendapat tautan; akun yang dinonaktifkan admin tidak boleh "dihidupkan" lewat reset. */
export async function requestPasswordReset(email: string): Promise<ResetRequest> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, fullName: true, isActive: true } })
  if (!user || !user.isActive) return { kind: 'none' }
  return { kind: 'send', token: await issueToken({ type: 'password_reset', userId: user.id }), fullName: user.fullName }
}

export type ResetResult = { ok: true; user: { id: string; role: UserRole } } | { ok: false }

export async function resetPassword(rawToken: string, newPassword: string): Promise<ResetResult> {
  if (!(await peekToken(rawToken, 'password_reset'))) return { ok: false }
  const passwordHash = await hash(newPassword, BCRYPT_COST)

  return prisma.$transaction(async (tx) => {
    const t = await claimToken(tx, rawToken, 'password_reset')
    if (!t?.userId) return { ok: false as const }
    const user = await tx.user.findUnique({ where: { id: t.userId }, select: { id: true, role: true, isActive: true, emailVerifiedAt: true } })
    if (!user || !user.isActive) return { ok: false as const }

    await tx.user.update({
      where: { id: user.id },
      // Tautan terkirim ke kotak masuk = bukti kepemilikan email (juga mengaktifkan akun lama yang belum terverifikasi).
      data: { passwordHash, ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) },
    })
    await tx.authToken.deleteMany({ where: { userId: user.id, type: 'password_reset', usedAt: null } })
    return { ok: true as const, user: { id: user.id, role: user.role } }
  })
}
