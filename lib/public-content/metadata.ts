import type { Metadata } from 'next'
import { hasLocale } from 'next-intl'
import { routing } from '@/i18n/routing'
import { localizedAlternates, ogAlternateLocales, ogLocale } from '@/lib/seo/site'
import { getPageText } from './content'
import { PUBLIC_PAGES, type PublicPageKey } from './pages'

// Metadata satu halaman katalog publik (docs/arsitektur-frontend-publik.md §6.7 G1): judul + deskripsi dari teks halaman (bisa diedit di Konten Situs),
// canonical + hreflang dari lib/seo/site.ts. Tanpa gambar Open Graph sampai ada foto yang berhak dipakai (K6).
export async function catalogMetadata(locale: string, page: PublicPageKey): Promise<Metadata> {
  if (!hasLocale(routing.locales, locale)) return {}
  const t = await getPageText(locale, page, 'meta')
  const title = t('title')
  const description = t('description')
  const path = PUBLIC_PAGES[page].path
  return {
    title,
    description,
    alternates: localizedAlternates(locale, path),
    openGraph: {
      type: 'website',
      siteName: 'Saudinesia',
      title,
      description,
      url: path ? `/${locale}/${path}` : `/${locale}`,
      locale: ogLocale(locale),
      alternateLocale: ogAlternateLocales(locale),
    },
    twitter: { card: 'summary', title, description },
  }
}
