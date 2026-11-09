import { notFound, redirect } from 'next/navigation'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { isPublicPageKey } from '@/lib/public-content/pages'
import { SiteContentEditor } from './SiteContentEditor'

// Editor isi satu halaman publik (docs/arsitektur-frontend-publik.md §6.5 C6) — hanya superadmin.
export default async function SiteContentEditPage({ params }: { params: Promise<{ locale: string; page: string }> }) {
  const { locale, page } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)
  if (!isPublicPageKey(page)) notFound()
  return <SiteContentEditor page={page} locale={safeLocale(locale)} />
}
