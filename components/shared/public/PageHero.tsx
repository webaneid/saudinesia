import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { HeroContent } from '@/lib/public-content/content'
import { BrandPattern } from './BrandPattern'
import { BrandLink } from './BrandLink'

export type HeroFact = { icon: LucideIcon; label: string }

type Props = {
  locale: string
  content: HeroContent
  /** `lg` = beranda, `md` = halaman katalog. */
  size?: 'lg' | 'md'
  /** Fakta dari data nyata (jumlah produk, harga mulai). Kosong = tidak ditampilkan (K3). */
  facts?: HeroFact[]
  /**
   * `search` (Tahap 4, §9 R1) = hero foto dengan kotak cari menempel di tepi bawahnya — dipakai katalog Pesawat dan Hotel.
   * Isi teks SAMA dengan varian bawaan (judul/subjudul/tombol dari Konten Situs); yang berbeda hanya tata letak.
   */
  variant?: 'default' | 'search'
  /** Isi kotak cari (varian `search`). Tanpa isi = hero foto biasa dengan ruang bawah yang lebih lega. */
  search?: ReactNode
}

// Hero satu-satunya untuk beranda dan semua katalog (docs/arsitektur-frontend-publik.md §6 H1, H3, §6.5 C5).
// Dengan foto (diunggah di Konten Situs): foto penuh + lapisan hijau gelap supaya teks putih tetap terbaca; tanpa foto: permukaan hijau + pola.
export function PageHero({ locale, content, size = 'md', facts = [], variant = 'default', search }: Props) {
  const lg = size === 'lg'
  const image = content.image
  // Foto (unggahan Konten Situs) + lapisan hijau gelap, atau pola brand bila belum ada foto — sama untuk semua varian.
  const backdrop = image ? (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- URL presigned MinIO (bucket private), sudah dikecilkan saat unggah (≤1600 px) */}
      <img src={image.src} alt={image.alt ?? ''} fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-brand-dark/95 via-brand-dark/80 to-brand-dark/40" aria-hidden />
    </>
  ) : (
    <BrandPattern id="hero-pattern" />
  )
  // Teks hero (label kecil, judul, subjudul, tombol, fakta) — SAMA untuk semua varian.
  const text = (
    <div className="relative max-w-2xl space-y-6">
      {content.eyebrow && (
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-gold">{content.eyebrow}</p>
      )}
      <h1 className={`font-bold leading-tight tracking-tight ${lg ? 'text-4xl md:text-5xl' : 'text-3xl md:text-5xl'}`}>{content.title}</h1>
      {content.subtitle && <p className="text-lg text-brand-light/90">{content.subtitle}</p>}
      {(content.primary || content.secondary) && (
        <div className="flex flex-col gap-3 sm:flex-row">
          {content.primary && <BrandLink locale={locale} link={content.primary} variant="gold" arrow />}
          {content.secondary && <BrandLink locale={locale} link={content.secondary} variant="glass" />}
        </div>
      )}
      {facts.length > 0 && (
        <ul className="flex flex-wrap gap-2 pt-2">
          {facts.map(({ icon: Icon, label }) => (
            <li key={label} className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium">
              <Icon className="h-4 w-4 text-brand-gold" aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
  if (variant === 'search') {
    return (
      <section>
        <div className="panel-brand rounded-3xl px-6 pb-20 pt-12 md:px-14 md:pb-24 md:pt-20">
          {backdrop}
          {text}
        </div>
        {search && <div className="hero-search">{search}</div>}
      </section>
    )
  }
  return (
    <section className={`panel-brand rounded-3xl px-6 md:px-14 ${lg ? 'py-14 md:py-20' : 'py-12 md:py-16'}`}>
      {backdrop}
      {text}
    </section>
  )
}
