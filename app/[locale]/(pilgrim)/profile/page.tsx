import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { ProfileForm } from './ProfileForm'
import { DeletionRequestCard } from './DeletionRequestCard'

type Props = { params: Promise<{ locale: string }> }

export default async function ProfilePage({ params }: Props) {
  const { locale } = await params
  const session = await getSession()
  if (!session) redirect(`/${locale}/login`)

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      fullName: true, email: true, phone: true, phoneVerifiedAt: true,
      address: true, // docs/arsitektur-alamat.md §9
    },
  })
  if (!user) redirect(`/${locale}/login`)

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Profil Saya</h1>
      <ProfileForm
        locale={locale}
        initialData={{ fullName: user.fullName, email: user.email ?? '', phone: user.phone ?? '' }}
        phoneVerified={!!user.phoneVerifiedAt}
        initialAddress={user.address}
      />
      <DeletionRequestCard />
    </div>
  )
}
