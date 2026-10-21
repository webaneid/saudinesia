import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { isContactComplete } from '@/lib/auth/contact'
import { safeLocale } from '@/lib/utils/locale'
import { LengkapiDataForm } from './LengkapiDataForm'

// Gerbang data awal (docs/arsitektur-auth.md §3.5): jamaah yang telepon/WhatsApp-nya belum lengkap (mis. baru daftar lewat Google)
// diarahkan ke sini oleh layout jamaah sampai selesai.
export default async function LengkapiDataPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = safeLocale((await params).locale)
  const session = await getSession()
  if (!session) redirect(`/${locale}/login`)
  if (session.role !== 'pilgrim') redirect(`/${locale}/admin`)

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { fullName: true, phone: true, whatsapp: true } })
  if (!user) redirect(`/${locale}/login`)
  if (isContactComplete(user)) redirect(`/${locale}/dashboard`)

  const consented = await prisma.consentLog.findFirst({ where: { userId: session.userId, type: 'whatsapp_notifications' }, select: { id: true } })
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <LengkapiDataForm locale={locale} name={user.fullName} phone={user.phone ?? ''} whatsapp={user.whatsapp ?? ''} needsConsent={!consented} />
    </main>
  )
}
