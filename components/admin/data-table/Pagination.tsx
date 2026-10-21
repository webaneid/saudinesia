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

/** Nomor halaman yang ditampilkan: pertama, terakhir, dan sekitar halaman aktif — sisanya elipsis. */
export function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  const keep = new Set([1, totalPages, page - 1, page, page + 1].filter(p => p >= 1 && p <= totalPages))
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1]
    if (prev !== undefined && p - prev > 1) out.push('gap')
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
          {pageWindow(page, totalPages).map((p, i) =>
            p === 'gap'
              ? <span key={`gap-${i}`} className="px-1 text-admin-muted">…</span>
              : <Cell key={p} {...nav} target={p} label={`Halaman ${p}`} active={p === page}>{p}</Cell>,
          )}
          <Cell {...nav} target={page + 1} label="Halaman berikutnya" disabled={page >= totalPages}><ChevronRight className="size-4" /></Cell>
        </nav>
      )}
    </div>
  )
}
