import { redirect } from 'next/navigation'
import { getSession, ADMIN_ROLES, MANAGER_ROLES } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> }

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params
  const session = await getSession()

  if (!session || !ADMIN_ROLES.includes(session.role)) {
    redirect(`/${locale}/admin/login`)
  }

  const role        = session.role
  const isManager   = MANAGER_ROLES.includes(role)
  const isSuperAdmin = role === 'superadmin'

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { fullName: true, email: true },
  })

  const userName = user?.fullName ?? user?.email ?? 'Admin'

  return (
    <div
      className="flex min-h-screen font-jakarta"
      style={{
        background: `
          radial-gradient(1200px 600px at 80% -10%, rgba(17,168,146,0.04), transparent 60%),
          radial-gradient(900px 500px at -10% 110%, rgba(176,122,30,0.03), transparent 60%),
          #F7F5EF
        `,
      }}
    >
      <AdminSidebar
        locale={locale}
        role={role}
        isManager={isManager}
        isSuperAdmin={isSuperAdmin}
        userName={userName}
      />
      <main className="flex-1 min-w-0 overflow-auto p-8">
        {children}
      </main>
    </div>
  )
}
