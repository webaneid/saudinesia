'use client'

import { useMemo } from 'react'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { matchPreset, periodPresets } from '@/lib/admin/period'

type PeriodFilterProps = {
  from: string
  to: string
  onChange: (range: { from: string; to: string }) => void
}

/** Filter periode standar halaman laporan: dropdown-autocomplete (Bulan ini, Bulan lalu, …) + dua kotak tanggal untuk rentang kustom. */
export function PeriodFilter({ from, to, onChange }: PeriodFilterProps) {
  const presets = useMemo(() => periodPresets(), [])
  return (
    <>
      <FilterSelect
        label="Periode" allLabel="Kustom" value={matchPreset(presets, from, to)}
        options={presets.map(p => ({ value: p.key, label: p.label }))}
        onChange={key => { const p = presets.find(x => x.key === key); if (p) onChange({ from: p.from, to: p.to }) }}
      />
      <input type="date" aria-label="Dari tanggal" className="admin-inp w-40" value={from} max={to} onChange={e => e.target.value && onChange({ from: e.target.value, to })} />
      <span className="text-xs text-admin-muted">s/d</span>
      <input type="date" aria-label="Sampai tanggal" className="admin-inp w-40" value={to} min={from} onChange={e => e.target.value && onChange({ from, to: e.target.value })} />
    </>
  )
}
