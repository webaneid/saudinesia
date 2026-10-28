import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PageMeta } from '@/lib/admin/pagination'

type PaginationProps = PageMeta & {
  /** Mode tautan (Server Component): href tiap halaman. */
  hrefFor?: (page: number) => string
  /** Mode tombol (Client Component): dipanggil saat halaman diganti. */
  onPageChange?: (page: number) => void
}

/** Halaman di tiap ujung yang selalu tampil: "1 2 3 … 20 21 22". */
const EDGE = 3

/**
 * Nomor halaman yang ditampilkan (docs/arsitektur-tabel.md §2.5): tiga halaman di tiap ujung + halaman aktif ±1; celah SATU halaman diisi dengan angkanya
 * (bukan elipsis yang menyembunyikan satu angka), celah lebih besar jadi elipsis. Contoh 22 halaman, aktif 10: 1 2 3 … 9 10 11 … 20 21 22.
 */
export function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  const keep = new Set<number>()
  for (let i = 1; i <= EDGE; i++) { keep.add(i); keep.add(totalPages - i + 1) }
  for (const p of [page - 1, page, page + 1]) keep.add(p)
  const sorted = [...keep].filter(p => p >= 1 && p <= totalPages).sort((x, y) => x - y)
  const out: (number | 'gap')[] = []
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1]
    if (prev !== undefined && p - prev === 2) out.push(prev + 1)
    else if (prev !== undefined && p - prev > 2) out.push('gap')
    out.push(p)
  })
  return out
}

const CELL = 'inline-flex size-9 items-center justify-center rounded-xl text-sm font-semibold transition'

type CellProps = Pick<PaginationProps, 'hrefFor' | 'onPageChange'> & {
  target: number
  label: string
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}

function Cell({ target, label, active, disabled, hrefFor, onPageChange, children }: CellProps) {
  const cls = cn(
    CELL,
    active ? 'bg-admin-accent text-white shadow-admin' : 'border border-admin-line bg-white text-admin-ink hover:border-admin-line-strong',
    disabled && 'pointer-events-none opacity-40',
  )
  if (disabled || active) {
    return <span aria-label={label} aria-current={active ? 'page' : undefined} aria-disabled={disabled || undefined} className={cls}>{children}</span>
  }
  if (hrefFor) return <Link href={hrefFor(target)} aria-label={label} className={cls}>{children}</Link>
  return <button type="button" aria-label={label} onClick={() => onPageChange?.(target)} className={cls}>{children}</button>
}

export function Pagination({ page, limit, total, totalPages, hrefFor, onPageChange }: PaginationProps) {
  if (total === 0) return null

  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)
  const nav = { hrefFor, onPageChange }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 text-xs text-admin-muted">
        Menampilkan <span className="font-semibold text-admin-ink">{from}–{to}</span> dari <span className="font-semibold text-admin-ink">{total}</span>
      </p>
      {totalPages > 1 && (
        <nav aria-label="Paginasi" className="flex items-center gap-1.5">
          <Cell {...nav} target={page - 1} label="Halaman sebelumnya" disabled={page <= 1}><ChevronLeft className="size-4" /></Cell>
          {/* HP: ringkas "5 / 22"; layar ≥ sm: deretan angka */}
          <span className="px-2 text-sm font-semibold tabular-nums text-admin-ink sm:hidden">{page} / {totalPages}</span>
          {pageWindow(page, totalPages).map((p, i) =>
            p === 'gap'
              ? <span key={`gap-${i}`} className="hidden px-1 text-admin-muted sm:inline">…</span>
              : <span key={p} className="hidden sm:inline-flex"><Cell {...nav} target={p} label={`Halaman ${p}`} active={p === page}>{p}</Cell></span>,
          )}
          <Cell {...nav} target={page + 1} label="Halaman berikutnya" disabled={page >= totalPages}><ChevronRight className="size-4" /></Cell>
        </nav>
      )}
    </div>
  )
}
