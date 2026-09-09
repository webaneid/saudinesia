'use client'

import { useState } from 'react'
import {
  ExternalLink, Pencil, Trash2, MoreVertical,
  Columns3, ArrowDownUp,
  Hash, Users, Clock, CircleDashed,
  ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react'

export type Campaign = {
  id: string
  title: string
  sub: string
  coverKind: string
  kategori: string
  status: 'ACTIVE' | 'DRAFT'
  goal: number
  collected: number
  updatedAt: string
  updatedBy: string
  donors: number
  daysLeft: number
}

const COVER_PALETTES: Record<string, { from: string; to: string; glyph: string }> = {
  amb: { from: '#0EA5A1', to: '#11A892', glyph: '+' },
  rmh: { from: '#0F766E', to: '#11A892', glyph: '⌂' },
  bnt: { from: '#B07A1E', to: '#E2B66A', glyph: '♥' },
}

const DEFAULT_PALETTE = { from: '#0EA5A1', to: '#11A892', glyph: '+' }

function CoverIcon({ kind }: { kind: string }) {
  const p = COVER_PALETTES[kind] ?? DEFAULT_PALETTE
  return (
    <div
      className="h-11 w-11 rounded-xl grid place-items-center text-white text-[18px] font-bold shrink-0 relative overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
    >
      <span
        className="absolute inset-0 opacity-30"
        style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,.5), transparent 50%)' }}
      />
      <span className="relative">{p.glyph}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: 'ACTIVE' | 'DRAFT' }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 h-6 px-2 pr-2.5 rounded-full bg-mint-50 text-mint-700 text-[10.5px] font-bold tracking-[0.08em]">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-mint-600 opacity-60 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint-600" />
        </span>
        ACTIVE
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2 pr-2.5 rounded-full bg-teal-50 text-teal-700 text-[10.5px] font-bold tracking-[0.08em]">
      <CircleDashed className="h-2.5 w-2.5 shrink-0" />
      DRAFT
    </span>
  )
}

function rupiah(n: number) {
  return 'Rp ' + n.toLocaleString('id-ID')
}

function ProgressMini({ collected, goal }: { collected: number; goal: number }) {
  const pct = goal === 0 ? 0 : Math.min(100, (collected / goal) * 100)
  return (
    <div className="w-[180px]">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="tabular-nums font-semibold text-ink2">{rupiah(collected)}</span>
        <span className="tabular-nums text-slate-500">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-canvas overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[10.5px] text-slate-500 tabular-nums">Goal {rupiah(goal)}</div>
    </div>
  )
}

type ActionBtnColor = 'ink' | 'teal' | 'rose'
const ACTION_BTN_CLASSES: Record<ActionBtnColor, string> = {
  ink:  'text-ink2 hover:text-ink hover:bg-canvas border-line',
  teal: 'text-teal-700 hover:bg-teal-50 border-teal-100',
  rose: 'text-rose-600 hover:bg-rose-50 border-rose-100',
}

function ActionBtn({ icon: Icon, color, title }: { icon: React.ElementType; color: ActionBtnColor; title: string }) {
  return (
    <button title={title} className={`h-8 w-8 rounded-full border grid place-items-center transition-colors ${ACTION_BTN_CLASSES[color]}`}>
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

export function CampaignTable({ rows }: { rows: Campaign[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const allSelected = rows.length > 0 && selected.size === rows.length

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)))

  const toggleOne = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="bg-white rounded-2xl border border-line/70 shadow-card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="text-[14px] font-bold text-ink">Daftar Campaign</div>
          <span className="text-[11.5px] text-slate-500 bg-canvas rounded-full px-2 py-0.5 font-medium">
            {rows.length} kampanye
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
          {selected.size > 0 && (
            <>
              <span className="font-semibold text-ink2">{selected.size} dipilih</span>
              <button className="h-7 px-2 rounded-md hover:bg-canvas transition-colors">Ubah status</button>
              <button className="h-7 px-2 rounded-md hover:bg-canvas text-rose-600 transition-colors">Hapus</button>
              <div className="w-px h-4 bg-line mx-1" />
            </>
          )}
          <button className="h-7 px-2 rounded-md hover:bg-canvas flex items-center gap-1 transition-colors">
            <Columns3 className="h-3 w-3" />
            Kolom
          </button>
          <button className="h-7 px-2 rounded-md hover:bg-canvas flex items-center gap-1 transition-colors">
            <ArrowDownUp className="h-3 w-3" />
            Urut: Terbaru
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10.5px] tracking-[0.1em] text-slate-500 font-bold uppercase bg-canvas/60">
              <th className="pl-5 pr-2 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-line accent-teal-600"
                />
              </th>
              <th className="px-2 py-3">Campaign</th>
              <th className="px-2 py-3">Kategori</th>
              <th className="px-2 py-3">Status</th>
              <th className="px-2 py-3">Nominal</th>
              <th className="px-2 py-3">Update</th>
              <th className="px-2 py-3 pr-5 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-[13px] text-slate-400">
                  Tidak ada kampanye yang sesuai filter.
                </td>
              </tr>
            ) : rows.map(r => {
              const sel = selected.has(r.id)
              return (
                <tr
                  key={r.id}
                  className={`border-t border-line hover:bg-canvas/40 transition-colors ${sel ? 'bg-teal-50/30' : ''}`}
                >
                  <td className="pl-5 pr-2 py-4 align-top pt-5">
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => toggleOne(r.id)}
                      className="h-3.5 w-3.5 rounded border-line accent-teal-600"
                    />
                  </td>
                  <td className="px-2 py-4 align-top">
                    <div className="flex items-start gap-3 max-w-[380px]">
                      <CoverIcon kind={r.coverKind} />
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-semibold text-ink leading-snug">{r.title}</div>
                        <div className="text-[11.5px] text-slate-500 mt-0.5 leading-snug line-clamp-2">{r.sub}</div>
                        <div className="mt-1.5 flex items-center gap-3 text-[10.5px] text-slate-500">
                          <span className="flex items-center gap-1">
                            <Hash className="h-2.5 w-2.5" />{r.id}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="h-2.5 w-2.5" />{r.donors} donatur
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />{r.daysLeft} hari lagi
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-4 align-top pt-5">
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink2 bg-canvas/80 border border-line rounded-full px-2.5 py-1 font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-ink2/60 shrink-0" />
                      {r.kategori}
                    </span>
                  </td>
                  <td className="px-2 py-4 align-top pt-5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-2 py-4 align-top pt-4">
                    <ProgressMini collected={r.collected} goal={r.goal} />
                  </td>
                  <td className="px-2 py-4 align-top pt-5">
                    <div className="text-[12.5px] text-ink2 font-medium tabular-nums">{r.updatedAt}</div>
                    <div className="text-[10.5px] text-slate-500">oleh {r.updatedBy}</div>
                  </td>
                  <td className="px-2 pr-5 py-4 align-top pt-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <ActionBtn icon={ExternalLink} color="teal" title="Lihat halaman publik" />
                      <ActionBtn icon={Pencil}       color="ink"  title="Edit campaign" />
                      <ActionBtn icon={Trash2}       color="rose" title="Hapus campaign" />
                      <button className="h-8 w-8 rounded-full border border-line grid place-items-center text-slate-500 hover:text-ink hover:bg-canvas transition-colors">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between px-5 py-3.5 border-t border-line text-[12px] text-slate-500">
        <div>
          Menampilkan{' '}
          <span className="text-ink2 font-semibold">1–{rows.length}</span>{' '}
          dari {rows.length} kampanye
        </div>
        <div className="flex items-center gap-1">
          <button className="h-8 w-8 rounded-lg border border-line grid place-items-center text-slate-500 hover:text-ink hover:bg-canvas transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button className="h-8 min-w-[32px] px-2 rounded-lg bg-ink text-white text-[12px] font-semibold">
            1
          </button>
          <button className="h-8 w-8 rounded-lg border border-line grid place-items-center text-slate-500 hover:text-ink hover:bg-canvas transition-colors">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-5 bg-line mx-2" />
          <div className="flex items-center gap-1.5">
            Per halaman
            <button className="h-8 px-2 rounded-lg border border-line text-ink2 font-medium flex items-center gap-1 hover:bg-canvas transition-colors">
              10 <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
