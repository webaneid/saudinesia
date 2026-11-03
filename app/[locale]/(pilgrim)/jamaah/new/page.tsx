import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { SavedPilgrimEditor } from '../SavedPilgrimEditor'

type Props = { params: Promise<{ locale: string }> }

export default async function NewSavedPilgrimPage({ params }: Props) {
  const { locale } = await params
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)
  if (session.role !== 'pilgrim') redirect(`/${safeLocale(locale)}/dashboard`)
  return <SavedPilgrimEditor locale={safeLocale(locale)} />
}
