'use client'

import { useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type MetaBoxProps = {
  title: string
  description?: ReactNode
  icon?: LucideIcon
  /** Dibuka saat pertama dirender; pengguna dapat melipat/membuka sesudahnya. */
  defaultOpen?: boolean
  /** Badge/teks kecil di sisi kanan judul (mis. mode komponen). */
  aside?: ReactNode
  /** false = kotak tetap terbuka tanpa tombol lipat (mis. kotak samping pendek). */
  collapsible?: boolean
  children: ReactNode
  className?: string
}

/**
 * Kotak berjudul ala WordPress "meta box" (docs/arsitektur-admin-editor.md): satu gaya judul/ikon/deskripsi untuk semua bagian editor, dapat dilipat.
 * Isi tetap ter-mount saat dilipat (disembunyikan) supaya isian yang belum disimpan tidak hilang.
 */
export function MetaBox({ title, description, icon: Icon, defaultOpen = true, aside, collapsible = true, children, className }: MetaBoxProps) {
  const [open, setOpen] = useState(defaultOpen)
  const expanded = !collapsible || open
  return (
    <section className={cn('admin-card overflow-hidden', className)}>
      <header className="flex items-start justify-between gap-2 border-b border-admin-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="m-0 flex items-center gap-1.5 text-sm font-semibold text-admin-ink">
            {Icon && <Icon className="size-4 shrink-0 text-admin-accent" />} {title}
          </h2>
          {description && <p className="m-0 mt-0.5 text-[11px] text-admin-muted">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {aside}
          {collapsible && (
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? `Lipat ${title}` : `Buka ${title}`} className="grid size-7 place-items-center rounded-lg text-admin-muted hover:bg-admin-spot hover:text-admin-ink">
              <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} />
            </button>
          )}
        </div>
      </header>
      <div hidden={!expanded} className="space-y-3 p-4">{children}</div>
    </section>
  )
}
