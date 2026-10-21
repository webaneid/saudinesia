import { redirect } from 'next/navigation'
import { getSession, ADMIN_ROLES } from '@/lib/auth/session'
import { AdminAuthShell } from '@/components/admin/shell/AdminAuthShell'
import { AdminLoginForm } from './AdminLoginForm'

export const metadata = { title: 'Admin Login' }

export default async function AdminLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await getSession()

  // Already authenticated as an admin role — go straight to dashboard
  if (session && ADMIN_ROLES.includes(session.role)) {
    redirect(`/${locale}/admin`)
  }

  return (
    <AdminAuthShell title="Masuk" description="Masuk dengan akun admin Anda">
      <AdminLoginForm locale={locale} />
    </AdminAuthShell>
  )
}
