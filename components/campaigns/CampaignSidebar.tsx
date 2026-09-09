'use client'

import Link from 'next/link'
import {
  LayoutDashboard, Megaphone, HandCoins, FileText,
  Sparkles, CalendarRange, MessageCircle,
  Settings2, ShieldCheck, CreditCard,
  Search, ChevronsUpDown,
  Repeat, LogOut, Users,
} from 'lucide-react'

type NavItem = {
  icon: React.ElementType
  label: string
  href: string
  active?: boolean
  badge?: string
}

type NavGroup = {
  group: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    group: 'CORE',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard',  href: '#' },
      { icon: Megaphone,       label: 'Campaign',   href: '#', active: true },
      { icon: HandCoins,       label: 'Donasi',     href: '#', badge: '24' },
      { icon: Users,           label: 'Donatur',    href: '#' },
      { icon: FileText,        label: 'Laporan',    href: '#' },
    ],
  },
  {
    group: 'EXPANSION',
    items: [
      { icon: Sparkles,       label: 'Program Insidental', href: '#' },
      { icon: CalendarRange,  label: 'Event & Acara',      href: '#' },
      { icon: MessageCircle,  label: 'Pesan Donatur',      href: '#', badge: '3' },
    ],
  },
  {
    group: 'TENANT',
    items: [
      { icon: Settings2,   label: 'Pengaturan', href: '#' },
      { icon: ShieldCheck, label: 'Tim & Akses', href: '#' },
      { icon: CreditCard,  label: 'Tagihan',    href: '#' },
    ],
  },
]

export function CampaignSidebar() {
  return (
    <aside className="w-[268px] shrink-0 h-screen sticky top-0 px-4 py-5 flex flex-col gap-5 bg-[#FAF8F2] border-r border-line">
      {/* Tenant card */}
      <div className="rounded-2xl bg-white shadow-soft border border-line/70 p-3 flex items-center gap-3">
        <div className="relative">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white grid place-items-center font-bold text-sm">
            ra
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-mint-600 ring-2 ring-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink truncate leading-tight">rumah-amanah</div>
          <div className="text-[11px] text-slate-500 truncate leading-tight">Yayasan · Tenant aktif</div>
        </div>
        <button
          className="h-7 w-7 rounded-lg hover:bg-canvas grid place-items-center text-slate-500"
          title="Switch tenant"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 h-3.5 w-3.5" />
        <input
          placeholder="Cari menu, campaign…"
          className="w-full h-9 pl-9 pr-12 rounded-xl bg-white border border-line text-[12.5px] text-ink placeholder:text-slate-400 focus:outline-none focus:border-teal-500/50 focus:ring-4 focus:ring-teal-500/10"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 bg-canvas border border-line rounded px-1.5 py-0.5 font-medium">
          ⌘K
        </kbd>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto space-y-5 pr-1 -mr-1 [scrollbar-width:thin] [scrollbar-color:#E5E3DA_transparent]">
        {NAV.map(grp => (
          <div key={grp.group}>
            <div className="px-2 text-[10px] font-bold tracking-[0.14em] text-slate-400 mb-2">
              {grp.group}
            </div>
            <ul className="space-y-0.5">
              {grp.items.map(item => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className={`group flex items-center gap-3 px-2.5 h-9 rounded-xl text-[13px] transition-colors ${
                      item.active
                        ? 'bg-teal-50 text-teal-700 font-semibold'
                        : 'text-ink2 hover:bg-white hover:shadow-soft'
                    }`}
                  >
                    <span className={`h-7 w-7 grid place-items-center rounded-lg shrink-0 ${
                      item.active
                        ? 'bg-white text-teal-600 shadow-soft'
                        : 'text-slate-500 group-hover:text-ink'
                    }`}>
                      <item.icon className="h-[15px] w-[15px]" />
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && (
                      <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${
                        item.active ? 'bg-white text-teal-700' : 'bg-canvas text-slate-500'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                    {item.active && <span className="h-1.5 w-1.5 rounded-full bg-teal-500 shrink-0" />}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Plan card */}
      <div className="rounded-2xl border border-line/70 bg-gradient-to-br from-teal-50 to-white p-3.5">
        <div className="flex items-center gap-2 mb-2">
          <span className="h-7 w-7 rounded-lg bg-white grid place-items-center text-teal-600 shadow-soft shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="text-[12px] font-semibold text-ink">Plan Komunitas</div>
        </div>
        <div className="text-[11px] text-slate-500 leading-snug mb-2">
          62% kuota campaign bulan ini terpakai.
        </div>
        <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
          <div className="h-full w-[62%] rounded-full bg-gradient-to-r from-teal-500 to-teal-700" />
        </div>
      </div>

      {/* Bottom actions */}
      <div className="pt-1 border-t border-line flex items-center justify-between gap-2">
        <button className="flex-1 h-9 rounded-xl text-[12.5px] font-medium text-ink2 hover:bg-white hover:shadow-soft flex items-center gap-2 px-2.5 transition-colors">
          <Repeat className="h-3.5 w-3.5 text-slate-500" />
          Switch Tenant
        </button>
        <button className="h-9 px-2.5 rounded-xl text-[12.5px] font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition-colors">
          <LogOut className="h-3.5 w-3.5" />
          Keluar
        </button>
      </div>
    </aside>
  )
}
