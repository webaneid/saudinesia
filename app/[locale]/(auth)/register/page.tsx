import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { googleConfigured } from '@/lib/auth/google'
import { afterAuthPath, safeNextPath } from '@/lib/auth/nextPath'
import { authMetadata } from '../metadata'
import { RegisterForm } from './RegisterForm'

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => authMetadata(params, 'register')

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  const { locale } = await params
  const next = safeNextPath((await searchParams).next)
  const session = await getSession()
  if (session) redirect(afterAuthPath(safeLocale(locale), next))
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <RegisterForm locale={locale} next={next} googleEnabled={googleConfigured()} />
    </main>
  )
}
