import { redirect } from 'next/navigation'
import { ADMIN_ROLES, getSession, type SessionPayload } from '@/lib/auth/session'
import { safeLocale } from '@/lib/utils/locale'

/**
 * Penjaga sesi untuk Server Component HALAMAN admin yang membaca data (SEC-18, docs/arsitektur-auth.md §11).
 *
 * Layout `admin/(protected)` TIDAK cukup: Next.js tidak merender ulang layout pada navigasi lunak / permintaan RSC parsial, jadi
 * pemegang tab lama (atau cookie yang sudah dicabut) bisa memuat halaman tanpa melewati layout. Setiap `page.tsx` server yang
 * memakai Prisma wajib memanggil ini di baris pertama. `getSession()` didedup `cache()` — biayanya nol bila layout ikut berjalan.
 */
export async function requireAdminPage(locale: string): Promise<SessionPayload> {
  const session = await getSession()
  if (!session || !ADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin/login`)
  return session
}
