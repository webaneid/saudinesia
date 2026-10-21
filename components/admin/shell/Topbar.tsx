'use client'

import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Breadcrumbs } from './Breadcrumbs'
import { UserDropdown } from './UserDropdown'
import { SidebarContent, type AdminNavProps } from './Sidebar'

type TopbarProps = AdminNavProps & { userName: string; email: string; roleLabel: string }

export function Topbar({ locale, isManager, isSuperAdmin, userName, email, roleLabel }: TopbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <>
      <header className="glass-light sticky top-0 z-30 border-x-0 border-t-0 border-b-admin-line">
        <div className="mx-auto flex min-h-16 w-full max-w-[1480px] items-center justify-between gap-3 px-4 py-2.5 md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Buka menu"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-admin-accent text-white shadow-admin lg:hidden"
            >
              <Menu className="size-5" />
            </button>
            <Breadcrumbs locale={locale} />
          </div>
          <UserDropdown locale={locale} userName={userName} email={email} roleLabel={roleLabel} />
        </div>
      </header>

      {/* Drawer navigasi mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu navigasi">
          <div className="absolute inset-0 bg-admin-ink/40 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <div className="admin-rail absolute inset-y-0 left-0 flex w-[min(300px,85vw)] flex-col px-4 py-4 shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Tutup menu"
              className="glass mb-3 ml-auto inline-flex size-9 items-center justify-center rounded-xl text-white"
            >
              <X className="size-4" />
            </button>
            <SidebarContent locale={locale} isManager={isManager} isSuperAdmin={isSuperAdmin} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
