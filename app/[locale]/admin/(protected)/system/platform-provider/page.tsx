import { redirect } from 'next/navigation'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { adminHref } from '@/lib/admin/href'
import { PlatformProviderEditor } from './PlatformProviderEditor'

// Sistem → Platform Provider (docs/arsitektur-bagi-hasil.md, Fase 13a) — superadmin melihat; hanya akun Platform Provider yang mengubah (dijaga di API).
export default async function PlatformProviderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(adminHref(safeLocale(locale), '/admin'))
  return <PlatformProviderEditor />
}
