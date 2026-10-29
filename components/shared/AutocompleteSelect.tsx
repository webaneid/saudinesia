'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { matchOptions, type ComboOption } from '@/lib/ui/combobox'

export type AutocompleteOption = ComboOption

type Props = {
  options: AutocompleteOption[]
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  /** Tombol hapus pilihan di kotak terpilih. Matikan bila nilai wajib ada (mis. kode negara). Bawaan: true. */
  clearable?: boolean
  /** Placeholder kotak cari di dalam daftar. */
  searchPlaceholder?: string
  /** Kelas tambahan untuk kotak terpilih (mis. lebar). */
  className?: string
  // Kalau diisi, komponen TIDAK memfilter `options` sendiri (asumsi pemanggil sudah mengembalikan
  // hasil yang relevan dari server, mis. lewat endpoint pencarian) — dipakai untuk daftar besar
  // yang tidak realistis dimuat semua sekaligus. Kalau kosong (default), filter dilakukan lokal
  // atas `options` yang sudah dimuat penuh — cocok untuk daftar kecil-menengah (puluhan-ratusan).
  onSearch?: (query: string) => void
}

const LIST_MAX_PX = 288 // tinggi daftar (max-h-72) — dipakai menentukan buka ke atas/bawah
const GAP_PX = 8

// Combobox pencarian generik (docs/arsitektur-combobox.md) — satu-satunya dropdown pencarian untuk form (kontak, alamat, vendor, manifest).
// Kotak terpilih = tombol setinggi `Input`; daftar = popover berlatar PADAT (tidak transparan) berisi kotak cari + pilihan
// dengan ikon/penanda di depan, teks pendamping di kanan, centang pada yang terpilih. Daftar selalu selebar isinya (min selebar
// kotak), membuka ke atas bila ruang di bawah sempit, dan rata kanan bila meluap layar. Dua mode: filter lokal atau
// pencarian server-side (`onSearch`). Navigasi keyboard penuh (panah/Home/End/Enter/Esc/Tab) dengan pola ARIA combobox + listbox.
export function AutocompleteSelect({ options, value, onChange, placeholder = 'Pilih…', disabled, loading, clearable = true, searchPlaceholder = 'Ketik untuk mencari…', className, onSearch }: Props) {
  const uid = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [openUp, setOpenUp] = useState(false)
  const [alignRight, setAlignRight] = useState(false)

  const selected = options.find(o => o.id === value) ?? null
  const shown = useMemo(() => (onSearch ? options : matchOptions(options, query)), [options, query, onSearch])

  const close = useCallback((refocus: boolean) => {
    setOpen(false); setQuery('')
    if (refocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => { setCursor(0) }, [shown])

  // Buka ke atas bila ruang bawah sempit dan atas lebih lega — dihitung SEBELUM paint supaya tidak berkedip.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setOpenUp(window.innerHeight - rect.bottom < LIST_MAX_PX + 72 && rect.top > window.innerHeight - rect.bottom)
  }, [open])
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return
    const left = triggerRef.current.getBoundingClientRect().left
    setAlignRight(left + panelRef.current.offsetWidth > window.innerWidth - GAP_PX)
  }, [open, shown])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])

  // Pilihan yang disorot selalu terlihat saat berpindah dengan panah.
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  function choose(o: AutocompleteOption) {
    onChange(o.id)
    close(true)
  }

  function onQueryChange(next: string) {
    setQuery(next)
    onSearch?.(next)
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true) }
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Home') { e.preventDefault(); setCursor(0) }
    else if (e.key === 'End') { e.preventDefault(); setCursor(Math.max(shown.length - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = shown[cursor]; if (o) choose(o) }
    else if (e.key === 'Escape') { e.preventDefault(); close(true) }
    else if (e.key === 'Tab') close(false)
  }

  const listId = `${uid}-list`
  const showClear = clearable && selected && !disabled && !loading

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        disabled={disabled} onClick={() => (open ? close(false) : setOpen(true))} onKeyDown={onTriggerKey}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-md border bg-background px-3 text-left text-sm ring-offset-background transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          open ? 'border-ring' : 'border-input hover:border-muted-foreground/40',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {selected?.prefix && <span aria-hidden className="shrink-0 text-base leading-none">{selected.prefix}</span>}
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>{selected ? (selected.short ?? selected.label) : placeholder}</span>
        {loading && <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        {showClear && (
          <span
            role="button" tabIndex={-1} aria-label="Hapus pilihan"
            onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
            onClick={e => { e.stopPropagation(); onChange(null) }}
            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </span>
        )}
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && !disabled && (
        <div
          ref={panelRef}
          className={cn(
            'absolute z-50 w-max min-w-full max-w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-input bg-background shadow-xl',
            openUp ? 'bottom-full mb-1' : 'top-full mt-1',
            alignRight ? 'right-0' : 'left-0',
          )}
        >
          <div className="relative border-b border-input p-2">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label={placeholder}
              aria-activedescendant={shown[cursor] ? `${uid}-o${cursor}` : undefined}
              value={query} onChange={e => onQueryChange(e.target.value)} onKeyDown={onInputKey} placeholder={searchPlaceholder} autoComplete="off"
              className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <ul id={listId} ref={listRef} role="listbox" className="m-0 max-h-72 list-none overflow-y-auto p-1">
            {shown.length === 0 && <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">{loading ? 'Memuat…' : 'Tidak ada hasil.'}</li>}
            {shown.map((o, i) => (
              <li
                key={o.id} id={`${uid}-o${i}`} data-index={i} role="option" aria-selected={o.id === value}
                onMouseEnter={() => setCursor(i)} onMouseDown={e => { e.preventDefault(); choose(o) }}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm', i === cursor && 'bg-accent', o.id === value && 'font-medium text-primary')}
              >
                {o.prefix && <span aria-hidden className="shrink-0 text-base leading-none">{o.prefix}</span>}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.hint}</span>}
                <Check aria-hidden className={cn('size-4 shrink-0', o.id === value ? 'opacity-100' : 'opacity-0')} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
