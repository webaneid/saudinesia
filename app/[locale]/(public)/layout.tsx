import { Header } from '@/components/shared/Header'
import { PublicFooter } from '@/components/shared/PublicFooter'

export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return (
    <div className="flex min-h-screen flex-col">
      <Header locale={locale} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>
      <PublicFooter locale={locale} />
    </div>
  )
}
