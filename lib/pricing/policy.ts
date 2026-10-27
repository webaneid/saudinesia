import type { UserRole } from '@prisma/client'
import { ADMIN_ROLES, SUPERADMIN_ROLES } from '@/lib/auth/roles'
import { requireSession, type SessionPayload } from '@/lib/auth/session'

// SATU-SATUNYA tempat keputusan "siapa boleh apa" untuk harga (docs/arsitektur-harga-terpadu.md §7, §16). Route, halaman, dan DTO tidak boleh memeriksa peran harga
// sendiri-sendiri. Keputusan pemilik 2026-10-27: alur role belum ditentukan → sementara SEMUA peran admin boleh melihat modal/untung dan mengatur harga jual manual;
// mengubah aturan margin global tetap superadmin. Mengedit HPP/Komponen Biaya TIDAK dibuka di sini (tetap `requireSuperAdmin` di route-nya) — yang dibuka adalah
// MELIHAT dan harga jual. Alur role nanti = mengubah tiga fungsi ini saja. Jamaah dan publik tidak pernah.

export const canViewCost = (role: UserRole): boolean => ADMIN_ROLES.includes(role)
export const canSetSellPrice = (role: UserRole): boolean => ADMIN_ROLES.includes(role)
export const canChangeMarginRule = (role: UserRole): boolean => SUPERADMIN_ROLES.includes(role)

async function guard(allowed: (role: UserRole) => boolean): Promise<SessionPayload> {
  const session = await requireSession()
  if (!allowed(session.role)) throw new Error('Forbidden')
  return session
}

/** Melihat modal/untung, riwayat perubahan, dan Kesehatan Margin. */
export const requirePricingView = () => guard(canViewCost)
/** Mengatur / mengembalikan harga jual manual (dan modal manual pemilik manual-only). */
export const requirePricingEdit = () => guard(canSetSellPrice)
/** Mengubah aturan margin global. */
export const requireMarginRuleEdit = () => guard(canChangeMarginRule)
