import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { LoginForm } from './LoginForm'

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await getSession()
  if (session) redirect(`/${locale}/dashboard`)

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <LoginForm locale={locale} />
    </main>
  )
}
