'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { LABEL_SEGMEN, SEGMEN_TANPA_HALAMAN } from '@/lib/admin/navigation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function Breadcrumbs({ locale }: { locale: string }) {
  // Segmen pertama = locale; jejak dimulai dari "admin".
  const segments = usePathname().split('/').filter(Boolean).slice(1)
  const crumbs = segments.map((s, i) => ({
    href: `/${locale}/${segments.slice(0, i + 1).join('/')}`,
    // ID (UUID) tidak ditampilkan mentah.
    label: LABEL_SEGMEN[s] ?? (UUID.test(s) ? 'Detail' : s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
    linkable: !SEGMEN_TANPA_HALAMAN.has(s),
  }))

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1
        return (
          // HP: hanya halaman saat ini (jejak lengkap tampil mulai layar sm).
          <span key={c.href} className={`min-w-0 items-center gap-1.5 ${last ? 'flex' : 'hidden sm:flex'}`}>
            {i > 0 && <ChevronRight className="hidden size-3.5 shrink-0 text-admin-muted sm:block" />}
            {last ? (
              <span className="truncate font-semibold text-admin-ink">{c.label}</span>
            ) : c.linkable ? (
              <Link href={c.href} className="truncate text-admin-muted hover:text-admin-ink">{c.label}</Link>
            ) : (
              <span className="truncate text-admin-muted">{c.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
