import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { readSignupCookie, readSignupNext } from '@/lib/auth/google'
import { afterAuthPath } from '@/lib/auth/nextPath'
import { readSignupCookieValue } from '@/lib/auth/googleCookies'
import { GoogleSignupForm } from './GoogleSignupForm'

// Langkah terakhir pendaftaran Google: identitas SUDAH terverifikasi Google (cookie bertanda tangan); di sini pengguna menyetujui
// kebijakan privasi sebelum akun dibuat (UU PDP).
export default async function GoogleSignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const cookie = await readSignupCookieValue()
  const next = await readSignupNext(cookie)
  if (await getSession()) redirect(afterAuthPath(safeLocale(locale), next))
  const identity = await readSignupCookie(cookie)
  if (!identity) redirect(`/${safeLocale(locale)}/login?error=google_expired`)
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <GoogleSignupForm locale={locale} next={next} email={identity.email} initialName={identity.name} />
    </main>
  )
}
