import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { ProfileForm } from './ProfileForm'
import { DeletionRequestCard } from './DeletionRequestCard'
import { UserRound } from 'lucide-react'
import { WhatsappVerifyCard } from '@/components/shared/WhatsappVerifyCard'
import { getSavedPilgrim } from '@/lib/pilgrims/service'
import { activeFields, cardFieldDef, pilgrimCatalog } from '@/lib/pilgrim-data/catalog'
import { getTranslations } from 'next-intl/server'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props) {
  const tm = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'pilgrimArea.profile' })
  return { title: tm('metaTitle') }
}

export default async function ProfilePage({ params }: Props) {
  const { locale } = await params
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)

  const lang = safeLocale(locale)
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      fullName: true, email: true, phone: true, whatsapp: true, whatsappVerifiedAt: true, verifiedWhatsapp: true,
      address: { select: { type: true, fullAddress: true, postalCode: true, provinceId: true, regencyId: true, districtId: true, villageId: true, countryCode: true, city: true, stateRegion: true } }, // docs/arsitektur-alamat.md §9
    },
  })
  if (!user) redirect(`/${lang}/login`)
  const t = await getTranslations({ locale: lang, namespace: 'pilgrimArea.profile' })
  const [consented, selfCard, catalog] = await Promise.all([
    prisma.consentLog.findFirst({ where: { userId: session.userId, type: 'whatsapp_notifications' }, select: { id: true } }),
    prisma.savedPilgrim.findFirst({ where: { selfOfUserId: session.userId, archivedAt: null }, select: { id: true } }),
    pilgrimCatalog(),
  ])
  // Kartu "Saya sendiri" (NIK/paspor tersamar) — formulir profil menyimpannya bersama data akun (docs/rencana-profil-jamaah.md P3).
  const card = selfCard ? await getSavedPilgrim({ userId: session.userId, role: session.role }, session.userId, selfCard.id) : null
  const home = user.address ?? card?.address ?? null
  const address = home ? { ...home, postalCode: home.postalCode ?? '', city: home.city ?? '', stateRegion: home.stateRegion ?? '' } : null
  const verified = Boolean(user.whatsappVerifiedAt && user.verifiedWhatsapp === user.whatsapp)
  const initials = user.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4 rounded-2xl border bg-gradient-to-br from-primary/10 to-transparent p-5 sm:p-6">
        <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">{initials || <UserRound className="h-6 w-6" />}</span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </header>
      {/* HP: verifikasi → formulir → hapus akun; desktop: formulir di kiri, dua kartu di kanan. */}
      <div className="grid items-start gap-6 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        {/* key = nomor: berganti nomor → kartu dimuat ulang dari server (verifikasi dicabut saat nomor berubah) */}
        <WhatsappVerifyCard key={user.whatsapp ?? ''} number={user.whatsapp ?? ''} initialVerified={verified} className="lg:col-start-3 lg:row-start-1" />
        <div className="lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <ProfileForm
            needsConsent={!consented}
            account={{ fullName: user.fullName, email: user.email ?? '', phone: user.phone ?? '', whatsapp: user.whatsapp ?? '' }}
            address={address}
            card={card}
            fields={activeFields(catalog).map(cardFieldDef)}
          />
        </div>
        <div className="lg:col-start-3 lg:row-start-2"><DeletionRequestCard /></div>
      </div>
    </div>
  )
}
