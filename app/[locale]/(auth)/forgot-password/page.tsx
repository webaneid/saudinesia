import { authMetadata } from '../metadata'
import { ForgotPasswordForm } from './ForgotPasswordForm'

type Props = { params: Promise<{ locale: string }> }

export const generateMetadata = ({ params }: Props) => authMetadata(params, 'forgot')

export default async function ForgotPasswordPage({ params }: Props) {
  const { locale } = await params
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <ForgotPasswordForm locale={locale} />
    </main>
  )
}
