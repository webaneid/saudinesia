import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { ProfileForm } from './ProfileForm'
import { DeletionRequestCard } from './DeletionRequestCard'
import { WhatsappVerifyCard } from '@/components/shared/WhatsappVerifyCard'

type Props = { params: Promise<{ locale: string }> }

export default async function ProfilePage({ params }: Props) {
  const { locale } = await params
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      fullName: true, email: true, phone: true, whatsapp: true, whatsappVerifiedAt: true, verifiedWhatsapp: true,
      address: true, // docs/arsitektur-alamat.md §9
    },
  })
  if (!user) redirect(`/${safeLocale(locale)}/login`)
  const consented = await prisma.consentLog.findFirst({ where: { userId: session.userId, type: 'whatsapp_notifications' }, select: { id: true } })

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Profil Saya</h1>
      <ProfileForm
        locale={locale}
        needsConsent={!consented}
        initialData={{ fullName: user.fullName, email: user.email ?? '', phone: user.phone ?? '', whatsapp: user.whatsapp ?? '' }}
        initialAddress={user.address}
      />
      {/* key = nomor: berganti nomor → kartu dimuat ulang dari server (verifikasi dicabut saat nomor berubah) */}
      <WhatsappVerifyCard key={user.whatsapp ?? ''} hasNumber={Boolean(user.whatsapp)} initialVerified={Boolean(user.whatsappVerifiedAt && user.verifiedWhatsapp === user.whatsapp)} />
      <DeletionRequestCard />
    </div>
  )
}
