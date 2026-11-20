import { redirect } from 'next/navigation'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { adminHref } from '@/lib/admin/href'
import { sandboxAllowed } from '@/lib/payments/ipaymu'
import { InvoiceSettingsEditor } from './InvoiceSettingsEditor'

// Sistem → Pengaturan Invoice (docs/arsitektur-booking-engine-v2.md §6) — hanya superadmin.
export default async function InvoiceSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(adminHref(safeLocale(locale), '/admin'))
  // Hanya ADA/TIDAK kunci iPaymu yang dikirim ke klien (nilainya tak pernah).
  const ipaymuKeys = Boolean(process.env.IPAYMU_VA?.trim() && process.env.IPAYMU_API_KEY?.trim())
  return <InvoiceSettingsEditor ipaymuKeys={ipaymuKeys} sandboxAllowed={sandboxAllowed()} />
}
