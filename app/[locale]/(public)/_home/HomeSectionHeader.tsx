import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

type Props = {
  title: string
  description?: string
  /** Tautan "lihat semua" ke katalog bagian ini. */
  link?: { href: string; label: string }
}

export function HomeSectionHeader({ title, description, link }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-brand-dark">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {link && (
        <Link href={link.href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
          {link.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </div>
  )
}
