import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { ResetPasswordForm } from './ResetPasswordForm'

// Token ada di query string: jangan bocor lewat header Referer ke sumber daya/tautan lain.
export const metadata = { referrer: 'no-referrer' as const }

export default async function ResetPasswordPage({
  params, searchParams,
}: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params
  const { token } = await searchParams
  const session = await getSession()
  if (session) redirect(`/${locale}/dashboard`)
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <ResetPasswordForm locale={locale} token={typeof token === 'string' ? token : ''} />
    </main>
  )
}
