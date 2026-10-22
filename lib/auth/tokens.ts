import { createHash, randomBytes } from 'node:crypto'
import type { AuthToken, AuthTokenType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { TOKEN_PATTERN } from '@/lib/auth/tokenPattern'

// Token sekali pakai untuk pendaftaran & reset password (docs/arsitektur-auth.md §3.1).
// 256 bit acak; HANYA hash SHA-256 yang disimpan; kedaluwarsa singkat; klaim atomik (tidak bisa dipakai dua kali walau balapan).

export const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  registration: 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
  whatsapp_verification: 15 * 60 * 1000, // kode pendek diterbitkan oleh lib/auth/whatsappVerify.ts (bukan issueToken)
}

export { TOKEN_PATTERN }

type Db = Prisma.TransactionClient | typeof prisma

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

type IssueInput =
  | { type: 'registration'; email: string; payload: Prisma.InputJsonValue }
  | { type: 'password_reset'; userId: string }

/** Terbitkan token baru; token lama jenis yang sama (untuk email/pengguna yang sama) yang belum dipakai dihanguskan. */
export async function issueToken(input: IssueInput): Promise<string> {
  const raw = randomBytes(32).toString('base64url')
  const scope = input.type === 'registration' ? { email: input.email } : { userId: input.userId }
  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { type: input.type, usedAt: null, ...scope } }),
    prisma.authToken.create({
      data: {
        type: input.type,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS[input.type]),
        ...(input.type === 'registration' ? { email: input.email, payload: input.payload } : { userId: input.userId }),
      },
    }),
  ])
  return raw
}

/** Lihat token yang masih berlaku TANPA mengonsumsinya (untuk menampilkan halaman). */
export async function peekToken(raw: string, type: AuthTokenType): Promise<AuthToken | null> {
  if (!TOKEN_PATTERN.test(raw)) return null
  const t = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(raw) } })
  if (!t || t.type !== type || t.usedAt || t.expiresAt <= new Date()) return null
  return t
}

/** Klaim atomik: hanya satu pemanggil yang berhasil. Dipanggil di dalam transaksi bersama efek sampingnya (mis. membuat akun). */
export async function claimToken(db: Db, raw: string, type: AuthTokenType): Promise<AuthToken | null> {
  if (!TOKEN_PATTERN.test(raw)) return null
  const tokenHash = hashToken(raw)
  const claimed = await db.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  if (claimed.count !== 1) return null
  return db.authToken.findUnique({ where: { tokenHash } })
}
