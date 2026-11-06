import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'

export default async function NotFound() {
  const locale = await getLocale()
  const t = await getTranslations({ locale, namespace: 'common' })
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">{t('notFound')}</p>
      <Link href={`/${locale}`} className="text-primary hover:underline">
        {t('backHome')}
      </Link>
    </div>
  )
}
