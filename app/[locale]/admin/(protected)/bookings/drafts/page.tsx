import { redirect } from 'next/navigation'
import { requireAdminPage } from '@/lib/auth/pageGuards'

// Breadcrumb "Drafts" dari editor draf (§10.3): daftar draf = Daftar Booking berfilter status Draf.
export default async function DraftsIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await requireAdminPage(locale)
  redirect(`/${locale}/admin/bookings?status=draft`)
}
