import type { Metadata } from 'next'
import { hasLocale } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { getHomeData } from '@/lib/catalog/home'
import { localizedAlternates, ogAlternateLocales, ogLocale } from '@/lib/seo/site'
import { HomeHero } from './_home/HomeHero'
import { HomeServices } from './_home/HomeServices'
import { HomePackages } from './_home/HomePackages'
import { HomeVisa } from './_home/HomeVisa'
import { HomeHotels } from './_home/HomeHotels'
import { HomeMuthowif } from './_home/HomeMuthowif'
import { HomeSteps } from './_home/HomeSteps'
import { HomeCta } from './_home/HomeCta'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) return {}
  const t = await getTranslations({ locale, namespace: 'home.meta' })
  const title = t('title')
  const description = t('description')
  return {
    title: { absolute: title },
    description,
    alternates: localizedAlternates(locale),
    // Tanpa gambar sampai pemilik punya foto/logo yang berhak dipakai (§2 K6, §5).
    openGraph: {
      type: 'website',
      siteName: 'Saudinesia',
      title,
      description,
      url: `/${locale}`,
      locale: ogLocale(locale),
      alternateLocale: ogAlternateLocales(locale),
    },
    twitter: { card: 'summary', title, description },
  }
}

// Homepage publik (docs/arsitektur-frontend-publik.md §3): halaman ini hanya menyusun; data di lib/catalog/home.ts, bagian tanpa data tersembunyi.
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const data = await getHomeData()
  return (
    <div className="space-y-14">
      <HomeHero locale={locale} />
      <HomeServices locale={locale} />
      <HomePackages locale={locale} packages={data.packages} />
      <HomeVisa locale={locale} visas={data.visas} />
      <HomeHotels locale={locale} hotels={data.hotels} />
      <HomeMuthowif locale={locale} pricePerDay={data.muthowif?.pricePerDay ?? null} />
      <HomeSteps locale={locale} />
      <HomeCta locale={locale} />
    </div>
  )
}
