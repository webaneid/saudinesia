'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { ChevronDown, X, Loader2 } from 'lucide-react'

export type AutocompleteOption = { id: string; label: string }

type Props = {
  options: AutocompleteOption[]
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  // Kalau diisi, komponen TIDAK memfilter `options` sendiri (asumsi pemanggil sudah mengembalikan
  // hasil yang relevan dari server, mis. lewat endpoint pencarian) — dipakai untuk daftar besar
  // yang tidak realistis dimuat semua sekaligus. Kalau kosong (default), filter dilakukan lokal
  // atas `options` yang sudah dimuat penuh — cocok untuk daftar kecil-menengah (puluhan-ratusan).
  onSearch?: (query: string) => void
}

// Combobox pencarian generik — BUKAN spesifik alamat, dipakai ulang di mana pun butuh dropdown
// pencarian (bukan `<select>` polos): AddressPicker (Provinsi/Kab-Kota/Kecamatan/Desa/Negara,
// docs/arsitektur-alamat.md §3.1) dan form lain di masa depan. Mendukung 2 mode: filter lokal
// (default, `options` dimuat penuh sekali) atau pencarian server-side (`onSearch`, dipakai kalau
// daftarnya terlalu besar untuk dimuat semua — parent yang bertanggung jawab mem-fetch & meng-
// update `options` sesuai query). Navigasi keyboard (panah atas/bawah, Enter, Escape) didukung.
export function AutocompleteSelect({ options, value, onChange, placeholder = 'Cari...', disabled, loading, onSearch }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.id === value) ?? null

  const filtered = useMemo(() => {
    if (onSearch || !query) return options
    const q = query.toLowerCase()
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, query, onSearch])

  useEffect(() => { setHighlighted(0) }, [filtered])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectOption(o: AutocompleteOption) {
    onChange(o.id)
    setQuery('')
    setOpen(false)
  }

  function handleQueryChange(next: string) {
    setQuery(next)
    onSearch?.(next)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[highlighted]; if (o) selectOption(o) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ${disabled ? 'opacity-50' : 'cursor-text'}`}
        onClick={() => !disabled && setOpen(true)}
      >
        {open ? (
          <input
            autoFocus
            className="flex-1 outline-none bg-transparent"
            placeholder={selected?.label ?? placeholder}
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
          />
        ) : (
          <span className={`flex-1 truncate ${selected ? '' : 'text-muted-foreground'}`}>{selected?.label ?? placeholder}</span>
        )}
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
        {selected && !open && !loading && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onChange(null); setQuery('') }}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </div>

      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-input bg-popover shadow-lg">
          {filtered.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{loading ? 'Memuat...' : 'Tidak ada hasil.'}</p>}
          {filtered.map((o, i) => (
            <button
              key={o.id}
              type="button"
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => selectOption(o)}
              className={`block w-full text-left px-3 py-2 text-sm transition-colors ${
                i === highlighted ? 'bg-accent' : ''
              } ${o.id === value ? 'font-medium text-primary' : ''}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
