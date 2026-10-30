import type { UserRole } from '@prisma/client'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { requireSession, type SessionPayload } from '@/lib/auth/session'

// SATU titik keputusan "siapa boleh mengelola booking" (docs/arsitektur-booking-engine-v2.md D16): untuk sementara semua peran admin boleh semuanya
// (membuat draf, menerbitkan, mengisi data jamaah). Peran terperinci kelak cukup diubah di sini — pola lib/pricing/policy.ts.
export const canManageBookings = (role: UserRole): boolean => ADMIN_ROLES.includes(role)

export async function requireBookingManage(): Promise<SessionPayload> {
  const session = await requireSession()
  if (!canManageBookings(session.role)) throw new Error('Forbidden')
  return session
}
