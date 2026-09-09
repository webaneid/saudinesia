import { Header } from '@/components/shared/Header'

export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return (
    <>
      <Header locale={locale} />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </>
  )
}
