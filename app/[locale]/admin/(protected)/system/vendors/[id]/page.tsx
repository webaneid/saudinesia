import { notFound, redirect } from 'next/navigation'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { getVendor, listCategories, toVendorDto } from '@/lib/vendors/service'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { VendorEditPanel } from '@/components/admin/vendor/VendorEditPanel'

type Props = { params: Promise<{ locale: string; id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function VendorDetailPage({ params }: Props) {
  const { locale, id } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)
  if (!UUID.test(id)) notFound()

  const [found, categories] = await Promise.all([getVendor(id), listCategories()])
  if (!found) notFound()
  const vendor = toVendorDto(found.vendor)

  return (
    <div className="space-y-5">
      <PageHeader title={vendor.name} description="Ubah data vendor, lihat pemakaiannya, atau nonaktifkan/hapus." />
      <VendorEditPanel
        locale={locale}
        vendor={vendor}
        usage={found.usage}
        categories={categories.map(({ id: cid, slug, name, isActive }) => ({ id: cid, slug, name, isActive }))}
      />
    </div>
  )
}
