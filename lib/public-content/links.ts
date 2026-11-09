import { PUBLIC_NAV } from '@/components/shared/publicNav'

// Tujuan tombol hero/CTA hanya dari daftar putih ini, tidak pernah alamat bebas (docs/arsitektur-frontend-publik.md §6 H6).
// Isi halaman menyimpan KUNCI tujuan; alamat dibentuk di sini, jadi suntingan admin (F5) tak bisa menautkan keluar situs.

/** `''` = beranda, `register` = daftar akun, `#catalog` = daftar produk di halaman yang sama, sisanya katalog dari menu. */
export const LINK_TARGETS = ['', 'register', '#catalog', ...PUBLIC_NAV.map(n => n.path)] as const

export type LinkTarget = string

export const isLinkTarget = (v: unknown): v is LinkTarget => typeof v === 'string' && (LINK_TARGETS as readonly string[]).includes(v)

/** Id elemen tujuan `#catalog` di setiap halaman katalog. */
export const CATALOG_ANCHOR = 'catalog'

export function targetHref(locale: string, target: LinkTarget): string {
  if (!isLinkTarget(target)) throw new Error('Tujuan tautan di luar daftar putih')
  if (target.startsWith('#')) return target
  return target ? '/' + locale + '/' + target : '/' + locale
}

/** Tautan keluar dari data admin (peta situs, dsb.): hanya http/https, selain itu `null` — `javascript:` tak boleh jadi `href` di halaman publik. */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}
