import idMessages from '@/i18n/messages/id.json'
import enMessages from '@/i18n/messages/en.json'
import { routing, type AppLocale } from '@/i18n/routing'
import { LINK_TARGETS, type LinkTarget } from './links'

// Registry halaman publik yang isinya bisa diedit (docs/arsitektur-frontend-publik.md §6.5). Murni: tanpa DB dan tanpa next-intl, jadi dipakai server,
// editor admin, dan uji. Kolom yang bisa diedit DITURUNKAN dari berkas pesan (C1), bukan daftar yang dihafal.

type LinkSlot = { labelKey: string; target: LinkTarget }

type PageDef = {
  /** Nama di admin. */
  label: string
  /** Namespace pesan halaman; seluruh kunci daunnya (selain ICU) bisa diedit. */
  ns: string
  /** Rute publik halaman tanpa locale ('' = beranda). */
  path: string
  /** Tombol hero/CTA: label diambil dari kunci pesan, tujuan bawaan dari sini (tidak diterjemahkan). */
  links: Record<string, LinkSlot>
}

export const PUBLIC_PAGES = {
  home: {
    label: 'Beranda',
    ns: 'home',
    path: '',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: 'packages' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'visa' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
  packages: {
    label: 'Katalog Paket Umroh',
    ns: 'catalog.packages',
    path: 'packages',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: '#catalog' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'visa' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
  visa: {
    label: 'Katalog Visa',
    ns: 'catalog.visa',
    path: 'visa',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: '#catalog' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'packages' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
  haji: {
    label: 'Katalog Paket Haji',
    ns: 'catalog.haji',
    path: 'haji',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: '#catalog' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'packages' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
  hotels: {
    label: 'Katalog Hotel',
    ns: 'catalog.hotels',
    path: 'hotels',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: '#catalog' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'packages' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
  transport: {
    label: 'Katalog Transportasi',
    ns: 'catalog.transport',
    path: 'transport',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: '#catalog' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'tours' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
  muthowif: {
    label: 'Katalog Muthowif',
    ns: 'catalog.muthowif',
    path: 'muthowif',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: '#catalog' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'packages' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
  tours: {
    label: 'Katalog Ziarah',
    ns: 'catalog.tours',
    path: 'tours',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: '#catalog' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'transport' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
  flight: {
    label: 'Katalog Tiket Pesawat',
    ns: 'catalog.flight',
    path: 'flight',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: '#catalog' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'packages' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
  catering: {
    label: 'Katalog Katering',
    ns: 'catalog.catering',
    path: 'catering',
    links: {
      'hero.primary': { labelKey: 'hero.primaryCta', target: '#catalog' },
      'hero.secondary': { labelKey: 'hero.secondaryCta', target: 'packages' },
      'cta.primary': { labelKey: 'cta.button', target: 'register' },
    },
  },
} as const satisfies Record<string, PageDef>

export type PublicPageKey = keyof typeof PUBLIC_PAGES
export const PUBLIC_PAGE_KEYS = Object.keys(PUBLIC_PAGES) as PublicPageKey[]
export const isPublicPageKey = (v: string): v is PublicPageKey => Object.prototype.hasOwnProperty.call(PUBLIC_PAGES, v)
export type LinkSlotKey = string

/** Batas panjang satu teks suntingan. */
export const MAX_TEXT_LENGTH = 400

const MESSAGES: Record<AppLocale, unknown> = { id: idMessages, en: enMessages }

function at(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

function leaves(obj: unknown, prefix = ''): [string, string][] {
  if (typeof obj === 'string') return [[prefix, obj]]
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
}

export type EditableField = {
  /** Kunci relatif terhadap namespace halaman, mis. `hero.title`. */
  key: string
  /** Bagian halaman = segmen pertama kunci (`hero`, `services`, `cta`, …). */
  group: string
  defaults: Record<AppLocale, string>
  multiline: boolean
}

/** Teks berformat ICU (ada `{`) diisi data saat tampil — tidak bisa diedit (C1). */
export const isIcuText = (s: string) => s.includes('{')

/** Kolom yang bisa diedit satu halaman, urut sesuai berkas pesan bahasa bawaan. */
export function editableFields(page: PublicPageKey): EditableField[] {
  const ns = PUBLIC_PAGES[page].ns
  const base = leaves(at(MESSAGES[routing.defaultLocale], ns))
  const out: EditableField[] = []
  for (const [key] of base) {
    const defaults = Object.fromEntries(routing.locales.map(l => [l, at(at(MESSAGES[l], ns), key)])) as Record<AppLocale, unknown>
    if (routing.locales.some(l => typeof defaults[l] !== 'string' || isIcuText(defaults[l] as string))) continue
    const d = defaults as Record<AppLocale, string>
    out.push({ key, group: key.split('.')[0]!, defaults: d, multiline: routing.locales.some(l => d[l].length > 70) })
  }
  return out
}

export function linkSlots(page: PublicPageKey): { slot: string; labelKey: string; target: LinkTarget }[] {
  return Object.entries(PUBLIC_PAGES[page].links).map(([slot, v]) => ({ slot, ...v }))
}

/** Isi suntingan: teks per bahasa per kunci; tujuan tombol per slot (`null` = disembunyikan). */
export type PageOverrides = {
  text: Partial<Record<AppLocale, Record<string, string>>>
  links: Record<string, LinkTarget | null>
}

export const EMPTY_OVERRIDES: PageOverrides = { text: {}, links: {} }

/** Nama tujuan tombol untuk editor admin (bahasa bawaan). */
export function linkTargetOptions(): { value: LinkTarget; label: string }[] {
  const nav = (MESSAGES[routing.defaultLocale] as { nav: Record<string, string> }).nav
  const special: Record<string, string> = { '': 'Beranda', register: 'Daftar Akun', '#catalog': 'Daftar produk di halaman ini' }
  return LINK_TARGETS.map(v => ({ value: v, label: special[v] ?? `Katalog ${nav[v] ?? v}` }))
}
