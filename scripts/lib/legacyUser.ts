import type { PrismaClient } from '@prisma/client'

// Akun uji untuk DB PRA-migrasi. Klien Prisma proyek selalu mengikuti skema TERBARU dan ikut mengirim nilai bawaan kolom baru (mis. `allowVisaWithoutBundle`)
// saat INSERT, sehingga `db.user.create` gagal di DB yang belum punya kolom itu. SQL mentah ini hanya menyentuh kolom dasar `users` yang ada sejak awal.
export async function legacyUser(db: PrismaClient, d: { email: string; passwordHash?: string; fullName: string; role: 'pilgrim' | 'admin' | 'manager' | 'superadmin'; isActive?: boolean; emailVerifiedAt?: Date | null }): Promise<{ id: string }> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (id, email, "passwordHash", "fullName", role, "isActive", "emailVerifiedAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4::user_role, $5, $6, now()) RETURNING id`,
    d.email, d.passwordHash ?? 'x', d.fullName, d.role, d.isActive ?? true, d.emailVerifiedAt ?? null,
  )
  return rows[0]!
}
