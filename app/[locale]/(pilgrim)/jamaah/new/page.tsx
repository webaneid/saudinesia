import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { SavedPilgrimEditor } from '../SavedPilgrimEditor'
import { getTranslations } from 'next-intl/server'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props) {
  const tm = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'pilgrimArea.editor' })
  return { title: tm('newMetaTitle') }
}

export default async function NewSavedPilgrimPage({ params }: Props) {
  const { locale } = await params
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)
  if (session.role !== 'pilgrim') redirect(`/${safeLocale(locale)}/dashboard`)
  return <SavedPilgrimEditor locale={safeLocale(locale)} />
}
