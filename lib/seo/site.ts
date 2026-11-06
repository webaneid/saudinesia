import type { Metadata } from 'next'
import { routing, type AppLocale } from '@/i18n/routing'

// Satu sumber alamat situs dan tautan antarbahasa untuk metadata, robots, dan sitemap (docs/arsitektur-frontend-publik.md F3).
// NEXT_PUBLIC_APP_URL di-inline saat build. Nilai kosong/salah tidak boleh meruntuhkan layout akar, jadi jatuh ke alamat produksi.

const DEFAULT_ORIGIN = 'https://saudinesia.com'

export function siteOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || DEFAULT_ORIGIN).origin
  } catch {
    return DEFAULT_ORIGIN
  }
}

const OG_LOCALE: Record<AppLocale, string> = { id: 'id_ID', en: 'en_US' }

export const ogLocale = (locale: AppLocale): string => OG_LOCALE[locale]
export const ogAlternateLocales = (locale: AppLocale): string[] => routing.locales.filter(l => l !== locale).map(ogLocale)

/** Canonical + hreflang satu halaman publik. `path` tanpa locale ("" = beranda, "visa" = katalog). x-default = `/`, yang memilih bahasa lewat Accept-Language. */
export function localizedAlternates(locale: AppLocale, path = ''): NonNullable<Metadata['alternates']> {
  const at = (l: AppLocale) => `/${l}${path ? `/${path}` : ''}`
  return {
    canonical: at(locale),
    languages: {
      ...Object.fromEntries(routing.locales.map(l => [l, at(l)])),
      'x-default': path ? at(routing.defaultLocale) : '/',
    },
  }
}
