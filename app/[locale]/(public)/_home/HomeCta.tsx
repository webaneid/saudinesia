import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { HomePattern } from './HomePattern'

export async function HomeCta({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'home.cta' })
  return (
    <section className="panel-brand rounded-3xl px-6 py-12 text-center md:py-16">
      <HomePattern id="cta-pattern" />
      <div className="relative mx-auto max-w-xl space-y-5">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{t('title')}</h2>
        <p className="text-brand-light/90">{t('description')}</p>
        <Link
          href={`/${locale}/register`}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-gold px-6 font-semibold text-brand-dark transition-opacity hover:opacity-90"
        >
          {t('button')}
        </Link>
      </div>
    </section>
  )
}
