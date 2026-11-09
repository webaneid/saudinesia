import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { googleConfigured } from '@/lib/auth/google'
import { afterAuthPath, safeNextPath } from '@/lib/auth/nextPath'
import { LoginForm } from './LoginForm'

const GOOGLE_ERRORS: Record<string, string> = {
  google_unavailable: 'Masuk dengan Google belum tersedia. Gunakan email dan password.',
  google_denied: 'Masuk dengan Google dibatalkan.',
  google_failed: 'Masuk dengan Google gagal. Silakan coba lagi.',
  google_expired: 'Sesi pendaftaran Google berakhir. Silakan mulai lagi.',
  google_unverified: 'Email akun Google Anda belum terverifikasi oleh Google.',
  google_staff: 'Akun staf masuk dengan email dan password lewat halaman admin.',
  google_inactive: 'Akun ini dinonaktifkan. Hubungi kami untuk bantuan.',
  google_ratelimited: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.',
  google_conflict: 'Email ini sudah tersambung dengan akun Google lain. Hubungi kami untuk bantuan.',
}

export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; next?: string }> }) {
  const { locale } = await params
  const { error, next: rawNext } = await searchParams
  // Jalur kembali (mis. checkout) disaring daftar putih di server; klien hanya menerima nilai yang sudah sah (lib/auth/nextPath.ts).
  const next = safeNextPath(rawNext)
  const session = await getSession()
  if (session) redirect(afterAuthPath(safeLocale(locale), next))

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <LoginForm locale={locale} next={next} googleEnabled={googleConfigured()} initialError={typeof error === 'string' && Object.hasOwn(GOOGLE_ERRORS, error) ? (GOOGLE_ERRORS[error] ?? '') : ''} />
    </main>
  )
}
