import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ArrowRight } from 'lucide-react'
import { HomePattern } from './HomePattern'

export async function HomeHero({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'home.hero' })
  return (
    <section className="panel-brand rounded-3xl px-6 py-14 md:px-14 md:py-20">
      <HomePattern id="hero-pattern" />
      <div className="relative max-w-2xl space-y-6">
        <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">{t('title')}</h1>
        <p className="text-lg text-brand-light/90">{t('subtitle')}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/${locale}/packages`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-gold px-6 font-semibold text-brand-dark transition-opacity hover:opacity-90"
          >
            {t('primaryCta')} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href={`/${locale}/visa`}
            className="glass inline-flex min-h-11 items-center justify-center rounded-xl px-6 font-semibold text-white transition-colors hover:bg-white/20"
          >
            {t('secondaryCta')}
          </Link>
        </div>
      </div>
    </section>
  )
}
