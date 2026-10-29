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

/** Undangan akun buatan staf (docs/arsitektur-pelanggan.md §6): tautan "buat password" yang lebih lama daripada reset biasa karena penerimanya belum menunggu email. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

type IssueInput =
  | { type: 'registration'; email: string; payload: Prisma.InputJsonValue }
  | { type: 'password_reset'; userId: string; /** Umur khusus (bawaan 30 menit) — hanya untuk undangan akun. */ ttlMs?: number }

/**
 * Terbitkan token baru; token lama jenis yang sama (untuk email/pengguna yang sama) yang belum dipakai dihanguskan — KECUALI `keepExisting` (pemanggil menghanguskan
 * yang lama sendiri setelah emailnya benar-benar terkirim: `supersedeOlderTokens`, supaya kirim ulang yang gagal tak mematikan tautan lama yang masih berfungsi).
 * Diserialkan per (jenis, pengguna/email) dengan kunci penasihat transaksi: dua penerbitan bersamaan tak lagi sama-sama menghapus lalu sama-sama membuat (SEC-106).
 */
export async function issueToken(input: IssueInput, opts: { keepExisting?: boolean } = {}): Promise<string> {
  const raw = randomBytes(32).toString('base64url')
  const scope = input.type === 'registration' ? { email: input.email } : { userId: input.userId }
  const lockKey = `auth-token:${input.type}:${input.type === 'registration' ? input.email : input.userId}`
  await prisma.$transaction(async (tx) => {
    // $executeRaw: Prisma ORM tidak punya kunci penasihat. Kunci dilepas otomatis saat transaksi selesai.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
    if (!opts.keepExisting) await tx.authToken.deleteMany({ where: { type: input.type, usedAt: null, ...scope } })
    await tx.authToken.create({
      data: {
        type: input.type,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + (input.type === 'password_reset' && input.ttlMs ? input.ttlMs : TOKEN_TTL_MS[input.type])),
        ...(input.type === 'registration' ? { email: input.email, payload: input.payload } : { userId: input.userId }),
      },
    })
  })
  return raw
}

/** Hanguskan token yang BELUM dipakai dan diterbitkan SEBELUM `raw` (untuk pengguna/email dan jenis yang sama) — dipanggil setelah email token baru terkirim. */
export async function supersedeOlderTokens(raw: string): Promise<void> {
  const t = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(raw) } })
  if (!t) return
  await prisma.authToken.deleteMany({
    where: { type: t.type, usedAt: null, createdAt: { lt: t.createdAt }, ...(t.userId ? { userId: t.userId } : { email: t.email }) },
  })
}

/** Buang token yang tak jadi dikirim (kirim email gagal) supaya tak tersisa tautan hidup yang tak dimiliki siapa pun. */
export async function discardToken(raw: string): Promise<void> {
  await prisma.authToken.deleteMany({ where: { tokenHash: hashToken(raw), usedAt: null } })
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
