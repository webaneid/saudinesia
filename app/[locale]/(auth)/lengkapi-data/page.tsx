import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { getOnboardingState, isOnboardingComplete } from '@/lib/auth/contact'
import { safeLocale } from '@/lib/utils/locale'
import { LengkapiDataForm } from './LengkapiDataForm'

// Gerbang data awal (docs/arsitektur-auth.md §3.5; docs/arsitektur-pelanggan.md §6): jamaah yang telepon/WhatsApp-nya belum lengkap (mis. baru daftar lewat Google)
// ATAU yang belum memberi persetujuan Kebijakan Privasi / notifikasi WhatsApp (mis. akun yang dibuatkan admin) diarahkan ke sini oleh layout jamaah sampai selesai.
export default async function LengkapiDataPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = safeLocale((await params).locale)
  const session = await getSession()
  if (!session) redirect(`/${locale}/login`)
  if (session.role !== 'pilgrim') redirect(`/${locale}/admin`)

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { fullName: true } })
  const state = await getOnboardingState(session.userId)
  if (!user || !state) redirect(`/${locale}/login`)
  if (isOnboardingComplete(state)) redirect(`/${locale}/dashboard`)

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <LengkapiDataForm locale={locale} name={user.fullName} phone={state.phone ?? ''} whatsapp={state.whatsapp ?? ''} needsConsent={!state.whatsappConsent} needsPrivacy={!state.privacyConsent} />
    </main>
  )
}
