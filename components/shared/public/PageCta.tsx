import type { CtaContent } from '@/lib/public-content/content'
import { BrandPattern } from './BrandPattern'
import { BrandLink } from './BrandLink'

// Ajakan penutup satu-satunya untuk beranda dan semua katalog (docs/arsitektur-frontend-publik.md §6 H1).
export function PageCta({ locale, content }: { locale: string; content: CtaContent }) {
  return (
    <section className="panel-brand rounded-3xl px-6 py-12 text-center md:py-16">
      <BrandPattern id="cta-pattern" />
      <div className="relative mx-auto max-w-xl space-y-5">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{content.title}</h2>
        {content.description && <p className="text-brand-light/90">{content.description}</p>}
        {content.primary && <BrandLink locale={locale} link={content.primary} variant="gold" />}
      </div>
    </section>
  )
}
