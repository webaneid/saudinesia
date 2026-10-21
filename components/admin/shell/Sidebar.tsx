'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { getAdminNavigation, type NavGroup, type NavItem } from '@/lib/admin/navigation'

export type AdminNavProps = {
  locale: string
  isManager: boolean
  isSuperAdmin: boolean
}

export function Sidebar(props: AdminNavProps) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <aside
      className={`admin-rail sticky top-0 hidden h-screen shrink-0 flex-col border-r border-admin-line px-4 py-4 transition-[width] duration-200 lg:flex ${
        collapsed ? 'w-[84px]' : 'w-[262px]'
      }`}
    >
      <SidebarContent {...props} collapsed={collapsed} />
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="mt-3 flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-xs font-semibold text-white/85 hover:bg-white/15"
      >
        {collapsed ? (
          <ChevronsRight className="size-4" />
        ) : (
          <>
            <ChevronsLeft className="size-4" />
            Ciutkan
          </>
        )}
      </button>
    </aside>
  )
}

type SidebarContentProps = AdminNavProps & { collapsed?: boolean; onNavigate?: () => void }

/** Isi menu: dipakai sidebar desktop dan drawer mobile (sama isi, sama filter role). */
export function SidebarContent({ locale, isManager, isSuperAdmin, collapsed = false, onNavigate }: SidebarContentProps) {
  const pathname = usePathname()
  const groups = getAdminNavigation({ isManager, isSuperAdmin })

  // Satu item aktif: kecocokan terpanjang (mis. /admin/products/transport tidak ikut menyorot /admin).
  const activeHref = groups
    .flatMap(g => g.items.map(i => `/${locale}${i.path}`))
    .filter(href => isActive(pathname, href, `/${locale}/admin`))
    .sort((a, b) => b.length - a.length)[0]

  return (
    <>
      <IdentityCard collapsed={collapsed} isSuperAdmin={isSuperAdmin} isManager={isManager} />
      <nav className="scrollbar-none mt-4 flex-1 space-y-5 overflow-y-auto overscroll-contain">
        {groups.map(group => (
          <NavGroupBlock key={group.label} group={group} locale={locale} collapsed={collapsed} activeHref={activeHref} onNavigate={onNavigate} />
        ))}
      </nav>
    </>
  )
}

function IdentityCard({ collapsed, isSuperAdmin, isManager }: { collapsed: boolean; isSuperAdmin: boolean; isManager: boolean }) {
  const roleLabel = isSuperAdmin ? 'Super Admin' : isManager ? 'Manager' : 'Admin'
  return (
    <div className="glass rounded-2xl p-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/20 text-sm font-bold text-white">Sn</div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-bold tracking-wide text-white">Saudinesia</p>
            <p className="m-0 truncate text-[11px] text-white/70">{roleLabel}</p>
          </div>
        )}
      </div>
    </div>
  )
}

type NavGroupBlockProps = {
  group: NavGroup
  locale: string
  collapsed: boolean
  activeHref: string | undefined
  onNavigate?: () => void
}

function NavGroupBlock({ group, locale, collapsed, activeHref, onNavigate }: NavGroupBlockProps) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      {!collapsed && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="mb-2 flex w-full items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55"
        >
          {group.label}
          <ChevronDown className={`size-3 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      )}
      {open && (
        <div className="space-y-1">
          {group.items.map(item => (
            <NavRow key={item.path} item={item} href={`/${locale}${item.path}`} collapsed={collapsed} active={`/${locale}${item.path}` === activeHref} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

type NavRowProps = { item: NavItem; href: string; collapsed: boolean; active: boolean; onNavigate?: () => void }

function NavRow({ item, href, collapsed, active, onNavigate }: NavRowProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
        active
          ? 'bg-white text-admin-accent-strong shadow-admin [&>svg]:text-admin-gold-strong'
          : 'text-white/90 hover:bg-white/10'
      }`}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}

const isActive = (pathname: string, href: string, rootHref: string) =>
  href === rootHref ? pathname === rootHref : pathname === href || pathname.startsWith(`${href}/`)
