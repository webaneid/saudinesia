'use client'

import Link from 'next/link'
import {
  Bell, LifeBuoy, ChevronRight, ChevronDown,
  ArrowLeft, Download, Plus,
  List, PlusCircle, FilePen, Archive, BarChart3,
  Calendar,
} from 'lucide-react'

export type TabId = 'all' | 'create' | 'draft' | 'archive' | 'insight'

const TABS: { id: TabId; label: string; icon: React.ElementType; count?: number }[] = [
  { id: 'all',     label: 'All Campaigns',   icon: List,       count: 3 },
  { id: 'create',  label: 'Create Campaign', icon: PlusCircle },
  { id: 'draft',   label: 'Draft',           icon: FilePen,    count: 1 },
  { id: 'archive', label: 'Arsip',           icon: Archive },
  { id: 'insight', label: 'Insight',         icon: BarChart3 },
]

type Props = {
  tab: TabId
  onTabChange: (t: TabId) => void
}

export function CampaignHeader({ tab, onTabChange }: Props) {
  return (
    <div>
      {/* Breadcrumb + topbar actions */}
      <div className="flex items-center justify-between text-[12px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <a href="#" className="hover:text-ink transition-colors">Tenant</a>
          <ChevronRight className="h-3 w-3" />
          <a href="#" className="hover:text-ink transition-colors">rumah-amanah</a>
          <ChevronRight className="h-3 w-3" />
          <span className="text-ink2 font-medium">Campaign</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="h-8 px-2.5 rounded-lg hover:bg-white hover:shadow-soft flex items-center gap-1.5 text-ink2 transition-colors">
            <Bell className="h-3.5 w-3.5" />
            <span className="text-[12px]">Notifikasi</span>
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          </button>
          <button className="h-8 px-2.5 rounded-lg hover:bg-white hover:shadow-soft flex items-center gap-1.5 text-ink2 transition-colors">
            <LifeBuoy className="h-3.5 w-3.5" />
            <span className="text-[12px]">Bantuan</span>
          </button>
          <div className="h-5 w-px bg-line mx-1" />
          <button className="flex items-center gap-2 pl-1 pr-2 h-8 rounded-lg hover:bg-white hover:shadow-soft transition-colors">
            <div className="h-6 w-6 rounded-md bg-gold-50 text-gold-600 grid place-items-center text-[10px] font-bold">
              FA
            </div>
            <span className="text-[12px] text-ink2 font-medium">Fadhil A.</span>
            <ChevronDown className="h-3 w-3 text-slate-500" />
          </button>
        </div>
      </div>

      {/* Title row */}
      <div className="mt-5 flex items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.02em] text-ink">
              Campaign
            </h1>
            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-white shadow-soft border border-line text-[11px] font-medium text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-mint-600" />
              Sinkron · 2 menit lalu
            </span>
          </div>
          <p className="mt-2 text-[14px] text-slate-500 max-w-[60ch]">
            Kelola seluruh kampanye penggalangan dana yayasan — pantau progress, ubah status, dan terbitkan kampanye baru ke halaman publik.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="#"
            className="h-10 px-3.5 rounded-xl bg-white border border-line shadow-soft text-[13px] font-semibold text-ink2 hover:text-ink flex items-center gap-2 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>
          <button className="h-10 px-3.5 rounded-xl bg-white border border-line shadow-soft text-[13px] font-semibold text-ink2 hover:text-ink flex items-center gap-2 transition-colors">
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button className="h-10 px-4 rounded-xl bg-ink text-white text-[13px] font-semibold flex items-center gap-2 shadow-card hover:bg-ink2 transition-colors">
            <Plus className="h-3.5 w-3.5" />
            Buat Campaign
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mt-6 flex items-center gap-1 border-b border-line">
        {TABS.map(t => {
          const active = t.id === tab
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`relative h-11 px-3.5 -mb-px text-[13px] flex items-center gap-2 transition-colors ${
                active
                  ? 'text-teal-700 font-semibold'
                  : 'text-slate-500 hover:text-ink2 font-medium'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {typeof t.count === 'number' && (
                <span className={`text-[10.5px] rounded-full px-1.5 py-0.5 font-semibold ${
                  active ? 'bg-teal-50 text-teal-700' : 'bg-canvas text-slate-500'
                }`}>
                  {t.count}
                </span>
              )}
              {active && (
                <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-teal-500" />
              )}
            </button>
          )
        })}
        <div className="ml-auto pb-2 pr-1 flex items-center gap-1.5 text-[12px] text-slate-500">
          <Calendar className="h-[13px] w-[13px]" />
          Periode{' '}
          <span className="font-semibold text-ink2">1 – 30 Apr 2026</span>
          <ChevronDown className="h-3 w-3" />
        </div>
      </div>
    </div>
  )
}
