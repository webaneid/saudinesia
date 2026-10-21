import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession, ADMIN_ROLES, MANAGER_ROLES } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { Sidebar } from '@/components/admin/shell/Sidebar'
import { Topbar } from '@/components/admin/shell/Topbar'

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> }

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params
  const session = await getSession()

  if (!session || !ADMIN_ROLES.includes(session.role)) {
    redirect(`/${safeLocale(locale)}/admin/login`)
  }

  const role         = session.role
  const isManager    = MANAGER_ROLES.includes(role)
  const isSuperAdmin = role === 'superadmin'

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { fullName: true, email: true },
  })

  const userName  = user?.fullName ?? user?.email ?? 'Admin'
  const email     = user?.email ?? ''
  const roleLabel = isSuperAdmin ? 'Super Admin' : isManager ? 'Manager' : 'Admin'

  return (
    <div className="admin-canvas flex min-h-screen font-jakarta text-admin-ink">
      <Sidebar locale={locale} isManager={isManager} isSuperAdmin={isSuperAdmin} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Topbar
          locale={locale}
          isManager={isManager}
          isSuperAdmin={isSuperAdmin}
          userName={userName}
          email={email}
          roleLabel={roleLabel}
        />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1480px] px-4 py-6 md:px-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
