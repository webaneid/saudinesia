import { redirect } from 'next/navigation'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { listCategories } from '@/lib/vendors/service'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { VendorCreatePanel } from '@/components/admin/vendor/VendorCreatePanel'

type Props = { params: Promise<{ locale: string }> }

export default async function NewVendorPage({ params }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)

  const categories = await listCategories()
  return (
    <div className="space-y-5">
      <PageHeader title="Vendor baru" description="Vendor yang dibuat di sini langsung tersedia di semua editor biaya." />
      <VendorCreatePanel locale={locale} categories={categories.map(({ id, slug, name, isActive }) => ({ id, slug, name, isActive }))} />
    </div>
  )
}
