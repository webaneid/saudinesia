import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { AdminLoginForm } from './AdminLoginForm'

export const metadata = { title: 'Admin Login' }

export default async function AdminLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await getSession()

  // Already authenticated as admin/superadmin — go straight to dashboard
  if (session && ['admin', 'superadmin'].includes(session.role)) {
    redirect(`/${locale}/admin`)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <AdminLoginForm locale={locale} />
    </main>
  )
}
