import { ForgotPasswordForm } from './ForgotPasswordForm'

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <ForgotPasswordForm locale={locale} />
    </main>
  )
}
