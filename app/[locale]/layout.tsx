import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  // v4: locale dan messages diwarisi dari i18n/request.ts — tak perlu getMessages() maupun prop.
  return (
    <NextIntlClientProvider>
      {children}
    </NextIntlClientProvider>
  )
}
