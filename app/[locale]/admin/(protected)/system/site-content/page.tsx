import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ExternalLink, ImageIcon, PanelsTopLeft, Pencil } from 'lucide-react'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { formatInstant } from '@/lib/time'
import { listPagesForAdmin } from '@/lib/public-content/service'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'

// Sistem → Konten Situs (docs/arsitektur-frontend-publik.md §6.5 C6) — hanya superadmin. Daftar halaman tetap dari registry kode (C7), bukan data yang tumbuh.
export default async function SiteContentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  const loc = safeLocale(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${loc}/admin`)
  const pages = await listPagesForAdmin()
  return (
    <div className="space-y-5">
      <PageHeader
        title="Konten Situs"
        description="Ubah teks halaman publik, dari hero sampai ajakan penutup, dalam bahasa Indonesia dan Inggris. Kolom yang dikosongkan memakai teks bawaan."
        icon={PanelsTopLeft}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {pages.map(p => (
          <article key={p.page} className="admin-card flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="m-0 text-base font-semibold text-admin-ink">{p.label}</h2>
                <p className="m-0 text-xs text-admin-muted">/{loc}{p.path ? `/${p.path}` : ''}</p>
              </div>
              <Badge tone={p.edited > 0 ? 'accent' : 'neutral'}>{p.edited > 0 ? `${p.edited} diubah` : 'Teks bawaan'}</Badge>
            </div>
            <p className="m-0 flex items-center gap-1.5 text-xs text-admin-muted">
              <ImageIcon className="size-3.5" aria-hidden /> {p.hasHeroImage ? 'Hero berfoto' : 'Hero tanpa foto'}
              <span aria-hidden>·</span> Diubah {formatInstant(p.updatedAt)}
            </p>
            {!p.visible && (
              <p className="m-0 text-xs text-admin-warning">Belum ada produk aktif — halaman ini dan menunya disembunyikan dari situs sampai produk pertama diaktifkan.</p>
            )}
            <div className="mt-auto flex flex-wrap gap-2">
              <Link href={`/${loc}/admin/system/site-content/${p.page}`} className="admin-btn-sm inline-flex items-center gap-1.5">
                <Pencil className="size-3.5" aria-hidden /> Edit konten
              </Link>
              <a href={`/${loc}${p.path ? `/${p.path}` : ''}`} target="_blank" rel="noopener" className="admin-btn-ghost text-xs">
                <ExternalLink className="size-3.5" aria-hidden /> Lihat halaman
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
