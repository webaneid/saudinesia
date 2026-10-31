'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Flag } from '@/components/shared/Flag'
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
  /** Nama aksesibel kotak (bila tak ada label terlihat di dekatnya). */
  ariaLabel?: string
  /** Kotak cari di dalam daftar. Bawaan: tampil bila pilihan > 7 atau memakai `onSearch`; daftar pendek (enum) tanpa kotak cari. */
  searchable?: boolean
  /** `sm` = setinggi baris tabel (aksi inline di sel). */
  size?: 'md' | 'sm'
  // Kalau diisi, komponen TIDAK memfilter `options` sendiri (asumsi pemanggil sudah mengembalikan
  // hasil yang relevan dari server, mis. lewat endpoint pencarian) — dipakai untuk daftar besar
  // yang tidak realistis dimuat semua sekaligus. Kalau kosong (default), filter dilakukan lokal
  // atas `options` yang sudah dimuat penuh — cocok untuk daftar kecil-menengah (puluhan-ratusan).
  onSearch?: (query: string) => void
}

const LIST_MAX_PX = 288 // tinggi daftar maksimum
const SEARCH_ROW_PX = 53 // tinggi baris kotak cari (+ garis)
const GAP_PX = 8 // jarak ke tepi layar / ke kotak

type Placement = { top?: number; bottom?: number; left: number; minWidth: number; listMax: number }

// Combobox pencarian generik (docs/arsitektur-combobox.md) — satu-satunya dropdown pencarian untuk form (kontak, alamat, vendor, manifest).
// Kotak terpilih = tombol setinggi `Input`; daftar = popover berlatar PADAT (tidak transparan) berisi kotak cari + pilihan
// dengan ikon/penanda di depan, teks pendamping di kanan, centang pada yang terpilih. Daftar dipasang lewat portal (`position: fixed` di atas segalanya; di dalam `<dialog>` modal: ke dialog itu)
// sehingga tidak pernah terpotong kartu/panel `overflow-hidden` induknya; selalu selebar isinya (min selebar kotak), membuka ke atas bila
// ruang di bawah sempit (tinggi daftar menyesuaikan sisa ruang), dan bergeser ke kiri bila meluap layar. Warna merek admin dibawa lewat `brand-scope`. Dua mode: filter lokal atau
// pencarian server-side (`onSearch`). Navigasi keyboard penuh (panah/Home/End/Enter/Esc/Tab) dengan pola ARIA combobox + listbox.
export function AutocompleteSelect({ options, value, onChange, placeholder = 'Pilih…', disabled, loading, clearable = true, searchPlaceholder = 'Ketik untuk mencari…', className, ariaLabel, searchable, size = 'md', onSearch }: Props) {
  const uid = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [place, setPlace] = useState<Placement | null>(null)

  const selected = options.find(o => o.id === value) ?? null
  const hasSearch = searchable ?? (!!onSearch || options.length > 7)
  const shown = useMemo(() => (onSearch ? options : matchOptions(options, query)), [options, query, onSearch])

  const close = useCallback((refocus: boolean) => {
    setOpen(false); setQuery('')
    if (refocus) triggerRef.current?.focus()
  }, [])

  // Sorotan awal: pilihan yang sedang terpilih (daftar pendek) atau yang teratas (saat mengetik).
  useEffect(() => { setCursor(query ? 0 : Math.max(0, shown.findIndex(o => o.id === value))) }, [shown, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Posisi daftar dihitung dari kotak terpilih SEBELUM paint (tak berkedip) dan diperbarui saat layar/gulir/ukuran berubah.
  const reposition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - GAP_PX * 2
    const above = rect.top - GAP_PX * 2
    const up = below < LIST_MAX_PX / 2 && above > below
    const room = (up ? above : below) - SEARCH_ROW_PX
    const panelWidth = panelRef.current?.offsetWidth ?? rect.width
    const left = Math.max(GAP_PX, Math.min(rect.left, window.innerWidth - GAP_PX - panelWidth))
    setPlace({
      ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      left, minWidth: rect.width, listMax: Math.max(120, Math.min(LIST_MAX_PX, room)),
    })
  }, [])
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return }
    reposition()
  }, [open, shown, reposition])
  useEffect(() => {
    if (!open) return
    const onMove = (e: Event) => { if (!(e.target instanceof Node && panelRef.current?.contains(e.target))) reposition() }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', reposition)
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', reposition) }
  }, [open, reposition])

  // Fokus ke kotak cari hanya setelah daftar terpasang dan terlihat (sebelum diposisikan ia `visibility: hidden` dan tak bisa difokuskan).
  const placed = place !== null
  useEffect(() => { if (open && placed) (hasSearch ? inputRef : listRef).current?.focus() }, [open, placed, hasSearch])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
      close(false)
    }
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
  const inAdmin = open && !!triggerRef.current?.closest('.admin-canvas')

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef} type="button" role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        disabled={disabled} onClick={() => (open ? close(false) : setOpen(true))} onKeyDown={onTriggerKey}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border bg-background text-left ring-offset-background transition-colors',
          size === 'sm' ? 'h-8 px-2 text-xs' : 'h-10 px-3 text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          open ? 'border-ring' : 'border-input hover:border-muted-foreground/40',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {selected?.flag && <Flag code={selected.flag} />}
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

      {open && !disabled && createPortal(
        <div
          ref={panelRef}
          style={place ? { top: place.top, bottom: place.bottom, left: place.left, minWidth: place.minWidth } : { visibility: 'hidden' }}
          className={cn(
            'fixed z-50 w-max max-w-[min(26rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-input bg-background text-foreground shadow-xl',
            inAdmin && 'brand-scope',
          )}
        >
          {hasSearch && (
          <div className="relative border-b border-input p-2">
              <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-label={ariaLabel ?? placeholder}
                aria-activedescendant={shown[cursor] ? `${uid}-o${cursor}` : undefined}
                value={query} onChange={e => onQueryChange(e.target.value)} onKeyDown={onInputKey} placeholder={searchPlaceholder} autoComplete="off"
                className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
          <ul
            id={listId} ref={listRef} role="listbox" aria-label={ariaLabel ?? placeholder} style={{ maxHeight: place?.listMax ?? LIST_MAX_PX }}
            tabIndex={hasSearch ? undefined : -1} onKeyDown={hasSearch ? undefined : onInputKey} aria-activedescendant={!hasSearch && shown[cursor] ? `${uid}-o${cursor}` : undefined}
            className="m-0 list-none overflow-y-auto p-1 outline-none"
          >
            {shown.length === 0 && <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">{loading ? 'Memuat…' : 'Tidak ada hasil.'}</li>}
            {shown.map((o, i) => (
              <li
                key={o.id} id={`${uid}-o${i}`} data-index={i} role="option" aria-selected={o.id === value}
                onMouseEnter={() => setCursor(i)} onMouseDown={e => { e.preventDefault(); choose(o) }}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm', i === cursor && 'bg-accent', o.id === value && 'font-medium text-primary')}
              >
                {o.flag && <Flag code={o.flag} />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.hint}</span>}
                <Check aria-hidden className={cn('size-4 shrink-0', o.id === value ? 'opacity-100' : 'opacity-0')} />
              </li>
            ))}
          </ul>
        </div>,
        // Di dalam `<dialog>` modal (showModal → top layer), daftar yang dipasang ke body tertutup dialog dan tak bisa diklik, berapa pun z-index-nya —
        // jadi pasang ke dialog terbuka terdekat. `position: fixed` tetap relatif ke viewport (dialog tidak bertransformasi).
        triggerRef.current?.closest('dialog[open]') ?? document.body,
      )}
    </div>
  )
}
