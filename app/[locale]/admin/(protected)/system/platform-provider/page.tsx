import { redirect } from 'next/navigation'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { PlatformProviderEditor } from './PlatformProviderEditor'

// Sistem → Platform Provider (docs/arsitektur-bagi-hasil.md, Fase 13a) — superadmin melihat; hanya akun Platform Provider yang mengubah (dijaga di API).
export default async function PlatformProviderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)
  return <PlatformProviderEditor />
}
