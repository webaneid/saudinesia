import { redirect } from 'next/navigation'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { getRefundSettings } from '@/lib/refunds/settings'
import { RefundSettingsEditor } from './RefundSettingsEditor'

// Keuangan → Kebijakan Refund (docs/rencana-force-majeure.md FM1) — hanya superadmin.
export default async function RefundSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)
  return <RefundSettingsEditor initial={await getRefundSettings()} />
}
