import { redirect } from 'next/navigation'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { InvoiceSettingsEditor } from './InvoiceSettingsEditor'

// Sistem → Pengaturan Invoice (docs/arsitektur-booking-engine-v2.md §6) — hanya superadmin.
export default async function InvoiceSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)
  return <InvoiceSettingsEditor />
}
