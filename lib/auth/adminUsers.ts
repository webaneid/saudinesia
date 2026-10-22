import type { Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/db'

export type AdminUserChange = { role?: UserRole; isActive?: boolean }

/**
 * Ubah peran / status aktif akun oleh superadmin. Mengembalikan null bila akun tidak ada.
 *
 * Perubahan NYATA pada peran atau status menaikkan `sessionVersion` → semua sesi lama dicabut (SEC-18). Ini juga berlaku saat akun
 * DIAKTIFKAN KEMBALI: tanpa kenaikan, token lama (mis. dari perangkat yang dicuri) hidup lagi begitu isActive kembali true.
 * Permintaan yang tidak mengubah apa pun tidak menendang siapa pun. Dinonaktifkan → nomor WhatsApp terverifikasinya DILEPAS
 * (kunci unik tak boleh menahan nomor yang bisa jadi sudah didaur ulang operator).
 */
export async function updateUserByAdmin(id: string, change: AdminUserChange) {
  return prisma.$transaction(async (tx) => {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE. Kunci baris menserialkan dua superadmin yang mengubah akun yang sama —
    // tanpa ini permintaan yang menganggap dirinya "tanpa perubahan" (membaca keadaan basi) bisa menimpa hasil permintaan lain tanpa mencabut sesi (S18-C).
    const locked = await tx.$queryRaw<{ role: UserRole; isActive: boolean }[]>`SELECT "role", "isActive" FROM "users" WHERE "id" = ${id} FOR UPDATE`
    const current = locked[0]
    if (!current) return null

    const changed =
      (change.isActive !== undefined && change.isActive !== current.isActive) ||
      (change.role !== undefined && change.role !== current.role)
    const data: Prisma.UserUpdateInput = { ...change }
    if (changed) data.sessionVersion = { increment: 1 }
    if (change.isActive === false) { data.whatsappVerifiedAt = null; data.verifiedWhatsapp = null }

    return tx.user.update({ where: { id }, data, select: { id: true, role: true, isActive: true } })
  })
}
