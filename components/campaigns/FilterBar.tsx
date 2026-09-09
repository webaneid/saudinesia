'use client'

import { useRef, useState, useEffect } from 'react'
import { Search, ChevronDown, Check, RotateCcw, SlidersHorizontal } from 'lucide-react'

const STATUS_OPTIONS  = ['Semua status', 'ACTIVE', 'DRAFT', 'ARSIP']
const KATEGORI_OPTIONS = ['Semua kategori', 'Layanan Sosial', 'Kesehatan', 'Pendidikan', 'Tanpa kategori']

type SelectProps = {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}

function Select({ label, value, options, onChange }: SelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="h-10 min-w-[170px] px-3 pr-2.5 rounded-xl bg-white border border-line shadow-soft text-[13px] text-ink2 font-medium flex items-center gap-2 hover:border-ink/20 transition-colors"
      >
        <span className="text-slate-400 text-[11px] font-semibold tracking-wide uppercase shrink-0">{label}</span>
        <span className="flex-1 text-left truncate">{value}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1.5 left-0 right-0 min-w-full bg-white border border-line rounded-xl shadow-card p-1 text-[13px]">
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false) }}
              className={`w-full text-left px-2.5 h-8 rounded-lg flex items-center justify-between hover:bg-canvas transition-colors ${
                opt === value ? 'text-teal-700 font-semibold' : 'text-ink2'
              }`}
            >
              {opt}
              {opt === value && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export type FilterBarProps = {
  q: string
  onQChange: (v: string) => void
  status: string
  onStatusChange: (v: string) => void
  kategori: string
  onKategoriChange: (v: string) => void
  onReset: () => void
}

export function FilterBar({
  q, onQChange,
  status, onStatusChange,
  kategori, onKategoriChange,
  onReset,
}: FilterBarProps) {
  return (
    <div className="bg-white rounded-2xl border border-line/70 shadow-soft p-2.5 flex items-center gap-2.5">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 h-[15px] w-[15px]" />
        <input
          value={q}
          onChange={e => onQChange(e.target.value)}
          placeholder="Cari campaign..."
          className="w-full h-10 pl-9 pr-3 rounded-xl bg-canvas border border-transparent text-[13px] text-ink placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-line transition-colors"
        />
      </div>
      <Select
        label="Status"
        value={status}
        options={STATUS_OPTIONS}
        onChange={onStatusChange}
      />
      <Select
        label="Kategori"
        value={kategori}
        options={KATEGORI_OPTIONS}
        onChange={onKategoriChange}
      />
      <button
        onClick={onReset}
        className="h-10 px-3 rounded-xl border border-line text-slate-500 hover:text-ink hover:bg-canvas text-[13px] font-medium flex items-center gap-1.5 transition-colors"
      >
        <RotateCcw className="h-[13px] w-[13px]" />
        Reset
      </button>
      <div className="w-px h-7 bg-line shrink-0" />
      <button className="h-10 px-3 rounded-xl border border-line text-ink2 hover:bg-canvas text-[13px] font-medium flex items-center gap-1.5 transition-colors">
        <SlidersHorizontal className="h-[13px] w-[13px]" />
        Filter
      </button>
    </div>
  )
}
