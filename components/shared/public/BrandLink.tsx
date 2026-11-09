import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { targetHref } from '@/lib/public-content/links'
import type { ContentLink } from '@/lib/public-content/content'

type Props = { locale: string; link: ContentLink; variant: 'gold' | 'glass' | 'solid'; arrow?: boolean }

const VARIANT = { gold: 'btn-brand-gold', glass: 'btn-brand-glass', solid: 'btn-brand-solid' } as const

/** Tombol hero/CTA. Alamat dibentuk dari kunci tujuan daftar putih, tak pernah dari teks bebas. */
export function BrandLink({ locale, link, variant, arrow }: Props) {
  const href = targetHref(locale, link.target)
  const body = (
    <>
      {link.label}
      {arrow && <ArrowRight className="h-4 w-4" aria-hidden />}
    </>
  )
  return href.startsWith('#')
    ? <a href={href} className={VARIANT[variant]}>{body}</a>
    : <Link href={href} className={VARIANT[variant]}>{body}</Link>
}
