'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

type SearchInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Jeda sebelum `onChange` dipanggil saat mengetik (ms). */
  delay?: number
}

/** Kotak cari untuk halaman KLIEN (padanan <SearchForm> halaman server): mengetik langsung menyaring setelah jeda singkat, bukan menunggu Enter. */
export function SearchInput({ value, onChange, placeholder = 'Cari…', delay = 300 }: SearchInputProps) {
  const [text, setText] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { setText(value) }, [value]) // "Atur ulang" / navigasi mengosongkan kotak
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function change(next: string) {
    setText(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange(next.trim()), delay)
  }

  return (
    <div role="search" className="relative w-full max-w-md flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-admin-muted" />
      <input value={text} onChange={e => change(e.target.value)} placeholder={placeholder} aria-label="Cari" className="admin-input pl-9 pr-10" />
      {text && (
        <button type="button" aria-label="Hapus pencarian" onClick={() => { setText(''); if (timer.current) clearTimeout(timer.current); onChange('') }} className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-admin-muted hover:text-admin-ink">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
