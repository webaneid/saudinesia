import type { Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/db'

export type AdminUserChange = { role?: UserRole; isActive?: boolean; fullName?: string }

export type AdminUserUpdate =
  | { ok: true; user: { id: string; role: UserRole; isActive: boolean; fullName: string } }
  | { ok: false; reason: 'not_found' | 'self' | 'last_superadmin' }

/**
 * Ubah peran / status aktif / nama akun oleh superadmin (nama tidak mempengaruhi sesi) (`actorId` = superadmin yang bertindak; null hanya untuk skrip/uji).
 *
 * Perubahan NYATA pada peran atau status menaikkan `sessionVersion` → semua sesi lama dicabut (SEC-18). Ini juga berlaku saat akun
 * DIAKTIFKAN KEMBALI: tanpa kenaikan, token lama (mis. dari perangkat yang dicuri) hidup lagi begitu isActive kembali true.
 * Permintaan yang tidak mengubah apa pun tidak menendang siapa pun. Dinonaktifkan → nomor WhatsApp terverifikasinya DILEPAS
 * (kunci unik tak boleh menahan nomor yang bisa jadi sudah didaur ulang operator).
 *
 * SEC-13: superadmin tidak boleh menurunkan/menonaktifkan DIRINYA SENDIRI, dan perubahan tidak boleh meninggalkan sistem tanpa
 * superadmin aktif sama sekali (tak ada jalur pemulihan lewat UI). Kedua aturan ditolak, bukan di-no-op-kan.
 */
export async function updateUserByAdmin(id: string, change: AdminUserChange, actorId: string | null): Promise<AdminUserUpdate> {
  return prisma.$transaction(async (tx) => {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE. Kunci baris menserialkan dua superadmin yang mengubah akun yang sama —
    // tanpa ini permintaan yang menganggap dirinya "tanpa perubahan" (membaca keadaan basi) bisa menimpa hasil permintaan lain tanpa mencabut sesi (S18-C).
    // Yang dikunci: akun target + SEMUA superadmin aktif, dalam urutan id yang sama di setiap transaksi (tanpa deadlock) — dua superadmin yang
    // saling menurunkan secara bersamaan berserial, jadi hitungan "superadmin tersisa" tidak pernah dibaca basi.
    const locked = await tx.$queryRaw<{ id: string; role: UserRole; isActive: boolean }[]>`
      SELECT "id", "role", "isActive" FROM "users"
      WHERE "id" = ${id} OR ("role" = 'superadmin' AND "isActive" = true)
      ORDER BY "id" FOR UPDATE`
    const current = locked.find(r => r.id === id)
    if (!current) return { ok: false, reason: 'not_found' } as const

    const roleChanges = change.role !== undefined && change.role !== current.role
    const statusChanges = change.isActive !== undefined && change.isActive !== current.isActive
    const changed = roleChanges || statusChanges

    if (actorId !== null && actorId === id && changed) return { ok: false, reason: 'self' } as const

    const losesSuperadmin = current.role === 'superadmin' && current.isActive &&
      ((roleChanges && change.role !== 'superadmin') || (statusChanges && change.isActive === false))
    if (losesSuperadmin && !locked.some(r => r.id !== id && r.role === 'superadmin' && r.isActive)) {
      return { ok: false, reason: 'last_superadmin' } as const
    }

    const data: Prisma.UserUpdateInput = { ...change }
    if (changed) data.sessionVersion = { increment: 1 }
    if (change.isActive === false) { data.whatsappVerifiedAt = null; data.verifiedWhatsapp = null }

    const user = await tx.user.update({ where: { id }, data, select: { id: true, role: true, isActive: true, fullName: true } })
    return { ok: true, user } as const
  })
}
