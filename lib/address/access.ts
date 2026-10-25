import { prisma } from '@/lib/db'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import type { SessionPayload } from '@/lib/auth/session'

/**
 * Siapa boleh membaca/mengubah baris `Address` tertentu (SEC-47). Baris alamat tidak punya pemilik sendiri — kepemilikan ada di FK
 * pihak lain (`User.addressId`, `Hotel.addressId`, `Vendor.addressId`). Staf (admin/manager/superadmin) boleh semua; pengguna biasa hanya
 * alamat yang menempel di AKUNNYA sendiri. Alamat hotel/vendor dan baris yatim bukan miliknya → false (pemanggil menjawab 404, bukan 403,
 * supaya keberadaan baris orang lain tidak bocor lewat perbedaan respons).
 */
export async function canAccessAddress(session: Pick<SessionPayload, 'userId' | 'role'>, addressId: string): Promise<boolean> {
  if (ADMIN_ROLES.includes(session.role)) return true
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { addressId: true } })
  return me?.addressId === addressId
}
