import { redirect } from 'next/navigation'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { adminHref } from '@/lib/admin/href'

// Breadcrumb "Drafts" dari editor draf (§10.3): daftar draf = Daftar Booking berfilter status Draf.
export default async function DraftsIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await requireAdminPage(locale)
  redirect(adminHref(locale, `/admin/bookings?status=draft`))
}
