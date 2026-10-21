import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { googleConfigured } from '@/lib/auth/google'
import { RegisterForm } from './RegisterForm'

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await getSession()
  if (session) redirect(`/${safeLocale(locale)}/dashboard`)
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <RegisterForm locale={locale} googleEnabled={googleConfigured()} />
    </main>
  )
}
