import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { readSignupCookie } from '@/lib/auth/google'
import { readSignupCookieValue } from '@/lib/auth/googleCookies'
import { GoogleSignupForm } from './GoogleSignupForm'

// Langkah terakhir pendaftaran Google: identitas SUDAH terverifikasi Google (cookie bertanda tangan); di sini pengguna menyetujui
// kebijakan privasi sebelum akun dibuat (UU PDP).
export default async function GoogleSignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (await getSession()) redirect(`/${safeLocale(locale)}/dashboard`)
  const identity = await readSignupCookie(await readSignupCookieValue())
  if (!identity) redirect(`/${safeLocale(locale)}/login?error=google_expired`)
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <GoogleSignupForm locale={locale} email={identity.email} initialName={identity.name} />
    </main>
  )
}
