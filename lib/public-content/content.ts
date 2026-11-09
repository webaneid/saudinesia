import { cache } from 'react'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { prisma } from '@/lib/db'
import { routing } from '@/i18n/routing'
import { getProductImages } from '@/lib/media/urls'
import { availableCatalogs, targetAvailable } from '@/lib/catalog/availability'
import { isLinkTarget, type LinkTarget } from './links'
import { PUBLIC_PAGES, linkSlots, type PageOverrides, type PublicPageKey } from './pages'
import { parseStoredContent } from './service'

export type { PublicPageKey } from './pages'

// SATU pembaca teks halaman publik (docs/arsitektur-frontend-publik.md §6.5 C4): suntingan admin menimpa berkas pesan, pesan jadi cadangan.
// Halaman dan bagiannya membaca teksnya HANYA lewat `getPageText`/`getPageContent`, bukan `getTranslations` atas namespace halaman.

export type ContentLink = { label: string; target: LinkTarget }
export type HeroImage = { src: string; alt: string | null }

export type HeroContent = {
  eyebrow: string | null
  title: string
  subtitle: string | null
  primary: ContentLink | null
  secondary: ContentLink | null
  image: HeroImage | null
}

export type CtaContent = { title: string; description: string | null; primary: ContentLink | null }
export type PageContent = { hero: HeroContent; cta: CtaContent }

/** Penerjemah satu halaman: `t('hero.title')`, `t('facts.count', { count })`; `has` = ada teksnya. */
export type PageText = ((key: string, values?: Record<string, string | number>) => string) & { has: (key: string) => boolean }

type StoredPage = { id: string; overrides: PageOverrides }

/** Satu baca DB per halaman per permintaan. Baris belum ada = tanpa suntingan. */
const loadPage = cache(async (page: PublicPageKey): Promise<StoredPage | null> => {
  const row = await prisma.publicPageContent.findUnique({ where: { pageKey: page }, select: { id: true, content: true } })
  return row ? { id: row.id, overrides: parseStoredContent(page, row.content) } : null
})

/** `prefix` = satu bagian halaman (`'services'` → `t('title')` membaca `services.title`). */
export async function getPageText(locale: string, page: PublicPageKey, prefix?: string): Promise<PageText> {
  const [stored, t] = await Promise.all([loadPage(page), getTranslations({ locale, namespace: PUBLIC_PAGES[page].ns })])
  const own = hasLocale(routing.locales, locale) ? stored?.overrides.text[locale] ?? {} : {}
  // Kunci ICU tak pernah ada di suntingan (C1), jadi `values` hanya untuk teks bawaan.
  const full = (key: string) => (prefix ? `${prefix}.${key}` : key)
  const base = t as unknown as ((k: string, v?: Record<string, string | number>) => string) & { has: (k: string) => boolean }
  const fn = ((key: string, values?: Record<string, string | number>) => own[full(key)] ?? base(full(key), values)) as PageText
  fn.has = (key: string) => full(key) in own || base.has(full(key))
  return fn
}

async function heroImageOf(stored: StoredPage | null): Promise<HeroImage | null> {
  if (!stored) return null
  const featured = (await getProductImages('public_page', [stored.id])).get(stored.id)?.featured
  return featured ? { src: featured.url, alt: featured.alt } : null
}

export async function getPageContent(locale: string, page: PublicPageKey): Promise<PageContent> {
  const [t, stored, available] = await Promise.all([getPageText(locale, page), loadPage(page), availableCatalogs()])
  const image = await heroImageOf(stored)
  const opt = (key: string) => (t.has(key) ? t(key) : null)
  const link = (slot: string): ContentLink | null => {
    const def = linkSlots(page).find(s => s.slot === slot)
    if (!def || !t.has(def.labelKey)) return null
    const over = stored?.overrides.links[slot]
    if (over === null) return null // disembunyikan admin
    const target = over !== undefined && isLinkTarget(over) ? over : def.target
    // Katalog tanpa produk = tombol disembunyikan sampai ada produk (§7 V4).
    if (!targetAvailable(target, available)) return null
    return { label: t(def.labelKey), target }
  }
  return {
    hero: { eyebrow: opt('hero.eyebrow'), title: t('hero.title'), subtitle: opt('hero.subtitle'), primary: link('hero.primary'), secondary: link('hero.secondary'), image },
    cta: { title: t('cta.title'), description: opt('cta.description'), primary: link('cta.primary') },
  }
}
