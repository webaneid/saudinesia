import Link from 'next/link'
import { X } from 'lucide-react'

type FilterBarProps = {
  /** Kotak cari (<SearchForm>) dan <FilterSelect> — selalu dalam urutan ini. */
  children: React.ReactNode
  /** Ada filter/pencarian aktif? Menampilkan tautan "Atur ulang". */
  active?: boolean
  /** Tujuan "Atur ulang" (halaman tanpa query; `limit` boleh dipertahankan) — untuk halaman server. */
  resetHref?: string
  /** "Atur ulang" untuk halaman klien (tombol, bukan tautan). */
  onReset?: () => void
}

/** Baris filter standar di atas setiap tabel (docs/arsitektur-tabel.md §2.3): pencarian + dropdown-autocomplete + Atur ulang. Server-safe. */
export function FilterBar({ children, active, resetHref, onReset }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter">
      {children}
      {active && resetHref && (
        <Link href={resetHref} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-admin-muted hover:text-admin-ink">
          <X className="size-4" /> Atur ulang
        </Link>
      )}
      {active && onReset && !resetHref && (
        <button type="button" onClick={onReset} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-admin-muted hover:text-admin-ink">
          <X className="size-4" /> Atur ulang
        </button>
      )}
    </div>
  )
}
