import type { UserRole } from '@prisma/client'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { requireSession, type SessionPayload } from '@/lib/auth/session'

// SATU titik keputusan "siapa boleh mengelola pelanggan" (docs/arsitektur-pelanggan.md §2 dan §6). Melihat: semua peran admin (halaman memakai requireAdminPage);
// menambah / mengirim undangan: semua peran admin (tugas operasional). Mengubah status akun tetap superadmin di Sistem → Pengguna.
export const canManageCustomers = (role: UserRole): boolean => ADMIN_ROLES.includes(role)

export async function requireCustomerManage(): Promise<SessionPayload> {
  const session = await requireSession()
  if (!canManageCustomers(session.role)) throw new Error('Forbidden')
  return session
}
