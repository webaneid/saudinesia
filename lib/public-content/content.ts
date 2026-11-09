import { getTranslations } from 'next-intl/server'
import type { LinkTarget } from './links'

// Satu pembaca isi hero dan CTA halaman publik (docs/arsitektur-frontend-publik.md §6 H5).
// F4: isi dari berkas pesan (i18n/messages, id + en). F5: suntingan admin menimpa pesan; pesan tetap jadi cadangan, jadi halaman tak perlu diubah.

export type ContentLink = { label: string; target: LinkTarget }

export type HeroContent = {
  eyebrow: string | null
  title: string
  subtitle: string | null
  primary: ContentLink | null
  secondary: ContentLink | null
}

export type CtaContent = {
  title: string
  description: string | null
  primary: ContentLink | null
}

export type PageContent = { hero: HeroContent; cta: CtaContent }

type ButtonSlot = { key: string; target: LinkTarget } | null

/** Halaman yang isinya dikelola lewat pembaca ini. `ns` = namespace pesan; tujuan tombol bukan teks, jadi tidak diterjemahkan. */
const PAGES = {
  home: {
    ns: 'home',
    hero: { primary: { key: 'primaryCta', target: 'packages' }, secondary: { key: 'secondaryCta', target: 'visa' } },
    cta: { primary: { key: 'button', target: 'register' } },
  },
  packages: {
    ns: 'catalog.packages',
    hero: { primary: { key: 'primaryCta', target: '#catalog' }, secondary: { key: 'secondaryCta', target: 'visa' } },
    cta: { primary: { key: 'button', target: 'register' } },
  },
} as const satisfies Record<string, { ns: string; hero: { primary: ButtonSlot; secondary: ButtonSlot }; cta: { primary: ButtonSlot } }>

export type PublicPageKey = keyof typeof PAGES
export const PUBLIC_PAGE_KEYS = Object.keys(PAGES) as PublicPageKey[]

export async function getPageContent(locale: string, page: PublicPageKey): Promise<PageContent> {
  const def = PAGES[page]
  const hero = await getTranslations({ locale, namespace: `${def.ns}.hero` })
  const cta = await getTranslations({ locale, namespace: `${def.ns}.cta` })
  const opt = (t: typeof hero, key: string) => (t.has(key) ? t(key) : null)
  const link = (t: typeof hero, slot: ButtonSlot): ContentLink | null => (slot && t.has(slot.key) ? { label: t(slot.key), target: slot.target } : null)
  return {
    hero: {
      eyebrow: opt(hero, 'eyebrow'),
      title: hero('title'),
      subtitle: opt(hero, 'subtitle'),
      primary: link(hero, def.hero.primary),
      secondary: link(hero, def.hero.secondary),
    },
    cta: {
      title: cta('title'),
      description: opt(cta, 'description'),
      primary: link(cta, def.cta.primary),
    },
  }
}
