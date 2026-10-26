import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { listCategories } from '@/lib/vendors/service'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Button } from '@/components/admin/ui/Button'
import { CategoryManager } from '@/components/admin/vendor/CategoryManager'

type Props = { params: Promise<{ locale: string }> }

export default async function VendorCategoriesPage({ params }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)

  const categories = await listCategories()
  return (
    <div className="space-y-5">
      <PageHeader
        title="Kategori Vendor"
        description="Kategori yang tersedia saat mengisi vendor. Kategori yang sudah dipakai vendor dinonaktifkan, tidak dihapus."
        actions={<Link href={`/${locale}/admin/system/vendors`}><Button variant="outline"><ArrowLeft className="size-4" /> Daftar vendor</Button></Link>}
      />
      <CategoryManager categories={categories} />
    </div>
  )
}
