import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { CATALOG_ANCHOR } from '@/lib/public-content/links'

type Props = {
  title: string
  description?: string | null
  /** Ditampilkan sebagai keadaan kosong bila `isEmpty`. */
  empty: { icon: LucideIcon; text: string }
  isEmpty: boolean
  /** Di atas daftar (mis. filter). */
  toolbar?: ReactNode
  children: ReactNode
}

// Bagian daftar produk setiap katalog (docs/arsitektur-frontend-publik.md §6.7 G2): judul, jangkar `#catalog` (tujuan tombol hero), keadaan kosong.
export function CatalogSection({ title, description, empty, isEmpty, toolbar, children }: Props) {
  const Icon = empty.icon
  return (
    <section id={CATALOG_ANCHOR} className="scroll-mt-24 space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-brand-dark">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {toolbar}
      {isEmpty ? (
        <div className="rounded-2xl border border-dashed p-16 text-center text-muted-foreground">
          <Icon className="mx-auto mb-3 h-12 w-12 opacity-30" aria-hidden />
          <p>{empty.text}</p>
        </div>
      ) : children}
    </section>
  )
}
