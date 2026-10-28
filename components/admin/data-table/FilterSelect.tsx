'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { filterHref, filterOptions, type FilterOption } from '@/lib/admin/filter'

// Filter standar admin (docs/arsitektur-tabel.md §2.3): dropdown dengan kotak ketik (autocomplete), pengganti pil/tab. Pola ARIA combobox + listbox; panah/Enter/Esc.
// Dua mode: `nav` (halaman server — props data biasa, tautan dibangun di sini, halaman kembali ke 1) atau `onChange` (halaman klien).

type Common = { label: string; options: readonly FilterOption[]; value: string; allLabel?: string }
type Props = Common & (
  | { nav: { base: string; param: string; /** param lain yang sedang aktif (q, filter lain, limit) */ query: Record<string, string | undefined> }; onChange?: never }
  | { onChange: (value: string) => void; nav?: never }
)

export function FilterSelect(props: Props) {
  const { label, options, value, allLabel = 'Semua' } = props
  const router = useRouter()
  const uid = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const all: FilterOption[] = useMemo(() => [{ value: '', label: allLabel }, ...options], [options, allLabel])
  const shown = useMemo(() => {
    const matched = filterOptions(options, query)
    return query.trim() && !allLabel.toLowerCase().includes(query.trim().toLowerCase()) ? matched : [{ value: '', label: allLabel }, ...matched]
  }, [options, query, allLabel])
  const current = all.find(o => o.value === value)
  const active = value !== ''

  useEffect(() => { setCursor(0) }, [query, open])
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function choose(next: string) {
    setOpen(false); setQuery('')
    if (props.nav) router.push(filterHref(props.nav.base, props.nav.query, props.nav.param, next))
    else props.onChange(next)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = shown[cursor]; if (o) choose(o.value) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  const listId = `${uid}-list`
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3 text-sm transition-colors',
          active ? 'border-admin-accent text-admin-accent-strong' : 'border-admin-line text-admin-ink hover:border-admin-line-strong',
        )}
      >
        <span className="text-admin-muted">{label}:</span>
        <span className="max-w-40 truncate font-semibold">{current?.label ?? allLabel}</span>
        <ChevronDown className="size-4 shrink-0 text-admin-muted" />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 max-w-[85vw] rounded-xl border border-admin-line bg-white p-2 shadow-admin">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-admin-muted" />
            <input
              ref={inputRef} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label={`Cari ${label}`}
              aria-activedescendant={shown[cursor] ? `${uid}-o${cursor}` : undefined}
              value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown} placeholder="Ketik untuk mencari…"
              className="admin-inp w-full pl-8"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={label} className="m-0 mt-2 max-h-60 list-none overflow-y-auto p-0">
            {shown.length === 1 && shown[0]!.value === '' && query.trim() && <li className="px-3 py-2 text-sm text-admin-muted">Tidak ada hasil.</li>}
            {shown.map((o, i) => (
              <li
                key={o.value || 'all'} id={`${uid}-o${i}`} role="option" aria-selected={o.value === value}
                onMouseEnter={() => setCursor(i)} onMouseDown={e => { e.preventDefault(); choose(o.value) }}
                className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm', i === cursor && 'bg-admin-spot', o.value === value && 'font-semibold text-admin-accent-strong')}
              >
                <span className="truncate">{o.label}</span>
                {o.value === value && <Check className="size-4 shrink-0" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
