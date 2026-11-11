import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { googleConfigured } from '@/lib/auth/google'
import { afterAuthPath, safeNextPath } from '@/lib/auth/nextPath'
import { authMetadata } from '../metadata'
import { LoginForm } from './LoginForm'

// Kode galat Google di URL (`?error=`) → kunci pesan. Daftar putih: kode lain diabaikan (tak pernah menampilkan teks dari URL).
const GOOGLE_ERRORS = {
  google_unavailable: 'googleUnavailable',
  google_denied: 'googleDenied',
  google_failed: 'googleFailed',
  google_expired: 'googleExpired',
  google_unverified: 'googleUnverified',
  google_staff: 'googleStaff',
  google_inactive: 'googleInactive',
  google_ratelimited: 'googleRatelimited',
  google_conflict: 'googleConflict',
} as const

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; next?: string }> }

export const generateMetadata = ({ params }: Pick<Props, 'params'>) => authMetadata(params, 'login')

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { error, next: rawNext } = await searchParams
  // Jalur kembali (mis. checkout) disaring daftar putih di server; klien hanya menerima nilai yang sudah sah (lib/auth/nextPath.ts).
  const next = safeNextPath(rawNext)
  const session = await getSession()
  if (session) redirect(afterAuthPath(safeLocale(locale), next))
  const t = await getTranslations({ locale: safeLocale(locale), namespace: 'authPages.login.errors' })
  const errorKey = typeof error === 'string' && Object.hasOwn(GOOGLE_ERRORS, error) ? GOOGLE_ERRORS[error as keyof typeof GOOGLE_ERRORS] : null

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <LoginForm locale={locale} next={next} googleEnabled={googleConfigured()} initialError={errorKey ? t(errorKey) : ''} />
    </main>
  )
}
