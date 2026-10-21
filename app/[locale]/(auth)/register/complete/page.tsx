import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { CompleteRegistrationForm } from './CompleteRegistrationForm'

// Token ada di query string: jangan bocor lewat header Referer ke sumber daya/tautan lain.
export const metadata = { referrer: 'no-referrer' as const }

export default async function CompleteRegistrationPage({
  params, searchParams,
}: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params
  const { token } = await searchParams
  const session = await getSession()
  if (session) redirect(`/${safeLocale(locale)}/dashboard`)
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <CompleteRegistrationForm locale={locale} token={typeof token === 'string' ? token : ''} />
    </main>
  )
}
