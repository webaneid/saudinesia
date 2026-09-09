'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, BookOpen, CreditCard, FileText, BarChart3, Bell,
  Package, Star, KeyRound, Building2, Bus, UserRound, UtensilsCrossed, MapPin, Landmark, CalendarDays, Plane,
  Users, Settings, LogOut, Search,
} from 'lucide-react'

type NavItem  = { href: string; icon: React.ElementType; label: string }
type NavGroup = { label: string; items: NavItem[] }

export type AdminSidebarProps = {
  locale: string
  role: string
  isManager: boolean
  isSuperAdmin: boolean
  userName: string
}

export function AdminSidebar({ locale, isManager, isSuperAdmin, userName }: AdminSidebarProps) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === `/${locale}/admin`
      ? pathname === `/${locale}/admin`
      : pathname.startsWith(href)

  const opsItems: NavItem[] = [
    { href: `/${locale}/admin`,               icon: LayoutDashboard, label: 'Overview' },
    { href: `/${locale}/admin/bookings`,      icon: BookOpen,        label: 'Booking' },
    { href: `/${locale}/admin/payments`,      icon: CreditCard,      label: 'Pembayaran' },
    { href: `/${locale}/admin/visa`,          icon: FileText,        label: 'Visa Status' },
    { href: `/${locale}/admin/quotas`,        icon: BarChart3,       label: 'Quota' },
    { href: `/${locale}/admin/notifications`, icon: Bell,            label: 'Notifikasi' },
  ]

  const productItems: NavItem[] = [
    { href: `/${locale}/admin/products/packages`,  icon: Package,         label: 'Paket' },
    { href: `/${locale}/admin/products/haji`,      icon: Star,            label: 'Haji' },
    { href: `/${locale}/admin/products/visa`,      icon: KeyRound,        label: 'Visa Produk' },
    { href: `/${locale}/admin/products/flight`,    icon: Plane,           label: 'Pesawat' },
    { href: `/${locale}/admin/products/hotels`,    icon: Building2,       label: 'Hotel' },
    { href: `/${locale}/admin/products/transport`, icon: Bus,             label: 'Transport' },
    { href: `/${locale}/admin/products/muthowif`,  icon: UserRound,       label: 'Muthowif' },
    { href: `/${locale}/admin/products/catering`,  icon: UtensilsCrossed, label: 'Katering' },
    { href: `/${locale}/admin/products/tourism-sites`, icon: MapPin,      label: 'Situs Wisata' },
    { href: `/${locale}/admin/products/tour-packages`, icon: Landmark,    label: 'Paket Ziarah' },
    { href: `/${locale}/admin/products/seasons`,   icon: CalendarDays,    label: 'Musim' },
  ]

  const systemItems: NavItem[] = [
    { href: `/${locale}/admin/system/users`,    icon: Users,    label: 'Pengguna' },
    { href: `/${locale}/admin/system/settings`, icon: Settings, label: 'Pengaturan' },
  ]

  const groups: NavGroup[] = [
    { label: 'OPERASIONAL', items: opsItems },
    ...(isManager   ? [{ label: 'PRODUK', items: productItems }] : []),
    ...(isSuperAdmin ? [{ label: 'SISTEM', items: systemItems  }] : []),
  ]

  const roleBadge = isSuperAdmin
    ? 'bg-gold-50 text-gold-600'
    : isManager
    ? 'bg-purple-50 text-purple-700'
    : 'bg-teal-50 text-teal-700'

  const roleLabel = isSuperAdmin ? 'Super Admin' : isManager ? 'Manager' : 'Admin'

  const initials = userName
    .split(' ')
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase() || 'A'

  return (
    <aside className="w-[268px] shrink-0 h-screen sticky top-0 px-4 py-5 flex flex-col gap-4 bg-[#FAF8F2] border-r border-line font-jakarta">
      {/* Brand card */}
      <div className="rounded-2xl bg-white shadow-soft border border-line/70 p-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white grid place-items-center font-extrabold text-sm shrink-0">
          Sn
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-ink truncate leading-tight">Saudinesia</div>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${roleBadge}`}>
            {roleLabel}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 h-3.5 w-3.5" />
        <input
          placeholder="Cari menu…"
          className="w-full h-9 pl-9 pr-3 rounded-xl bg-white border border-line text-[12.5px] text-ink placeholder:text-slate-400 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/10"
        />
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1 [scrollbar-width:thin] [scrollbar-color:#E5E3DA_transparent]">
        {groups.map(grp => (
          <div key={grp.label}>
            <div className="px-2 text-[10px] font-bold tracking-[0.14em] text-slate-400 mb-1.5">
              {grp.label}
            </div>
            <ul className="space-y-0.5">
              {grp.items.map(item => {
                const active = isActive(item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`group flex items-center gap-3 px-2.5 h-9 rounded-xl text-[13px] transition-colors ${
                        active
                          ? 'bg-teal-50 text-teal-700 font-semibold'
                          : 'text-ink2 hover:bg-white hover:shadow-soft'
                      }`}
                    >
                      <span className={`h-7 w-7 grid place-items-center rounded-lg shrink-0 ${
                        active
                          ? 'bg-white text-teal-600 shadow-soft'
                          : 'text-slate-500 group-hover:text-ink'
                      }`}>
                        <item.icon className="h-[15px] w-[15px]" />
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-teal-500 shrink-0" />}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User + logout */}
      <div className="pt-2 border-t border-line">
        <div className="flex items-center gap-2.5 px-2.5 py-1.5 mb-1">
          <div className="h-7 w-7 rounded-lg bg-gold-50 text-gold-600 grid place-items-center text-[10px] font-bold shrink-0">
            {initials}
          </div>
          <span className="text-[12.5px] font-medium text-ink2 flex-1 truncate">{userName}</span>
        </div>
        <form action="/api/v1/auth/logout" method="POST">
          <button
            type="submit"
            className="w-full h-9 rounded-xl text-[12.5px] font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2 px-2.5 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Keluar
          </button>
        </form>
      </div>
    </aside>
  )
}
