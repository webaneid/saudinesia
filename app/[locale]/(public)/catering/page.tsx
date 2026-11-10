import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, CalendarDays, Tag, UtensilsCrossed } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { checkoutPath } from '@/lib/checkout/kinds'
import { getFeaturedCards } from '@/lib/media/urls'
import { detectSeason } from '@/lib/utils/season'
import { cateringPricePerPersonPerDay } from '@/lib/pricing/computeCateringPrice'
import { cateringSeasonPrices } from '@/lib/pricing/engine/read'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
import { dbDateOf, todayInApp } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { ProductImage } from '@/components/shared/ProductImage'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'
import { CatalogSection } from '@/components/shared/public/CatalogSection'
import { PriceTag } from '@/components/shared/public/PriceTag'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return catalogMetadata((await params).locale, 'catering')
}

const MENUS = ['asian', 'arabic', 'western'] as const
/** Kunci DB (snake_case) → kunci pesan (camelCase, §6.5 C1). */
const BOARDS: Record<string, string> = { full_board: 'fullBoard', half_board: 'halfBoard' }

// Katalog Katering — pola katalog §6.7. Harga = per orang per hari untuk musim HARI INI (zona aplikasi). Blok "Keunggulan" lama dihapus (G5):
// klaim halal bersertifikat/chef tak bersumber data (K3).
export default async function CateringPage({ params }: Props) {
  const { locale } = await params
  await requireCatalog('catering')
  const [season, options, content, t] = await Promise.all([
    detectSeason(dbDateOf(todayInApp())),
    prisma.cateringOption.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    getPageContent(locale, 'catering'),
    getPageText(locale, 'catering'),
  ])
  const ids = options.map(o => o.id)
  const [covers, prices] = await Promise.all([getFeaturedCards('catering', ids), cateringSeasonPrices(ids)])
  const priceOf = (id: string) => {
    const p = prices.get(id)
    return p ? cateringPricePerPersonPerDay(p, season) : 0
  }

  const hasPrice = (id: string) => { const p = prices.get(id); return !!p && (p.regular > 0 || p.ramadan > 0 || p.hajj > 0) }
  const priced = ids.map(priceOf).filter(v => v > 0)
  const facts: HeroFact[] = []
  if (options.length > 0) {
    facts.push({ icon: UtensilsCrossed, label: t('facts.count', { count: options.length }) })
    if (priced.length > 0) facts.push({ icon: Tag, label: t('facts.priceFrom', { price: formatRupiah(Math.min(...priced)) }) })
    facts.push({ icon: CalendarDays, label: t('facts.season', { season: t(`card.seasons.${season}`) }) })
  }

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} />

      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: UtensilsCrossed, text: t('list.empty') }}
        isEmpty={options.length === 0}
      >
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {options.map(o => {
            const cover = covers.get(o.id)
            const board = BOARDS[o.boardType]
            return (
              <article key={o.id} className="catalog-card">
                <ProductImage src={cover?.src} alt={cover?.alt} fallbackAlt={o.name} type="catering" />
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="catalog-chip">{(MENUS as readonly string[]).includes(o.menuStyle) ? t(`card.menu.${o.menuStyle}`) : o.menuStyle}</span>
                      <span className="catalog-chip">{board ? t(`card.board.${board}`) : o.boardType}</span>
                    </div>
                    <h3 className="text-lg font-semibold leading-snug text-brand-dark">{o.name}</h3>
                    <RichTextView value={o.description} className="text-sm text-muted-foreground" />
                  </div>
                  <div className="mt-auto space-y-3 border-t pt-4">
                    <PriceTag price={priceOf(o.id)} label={t('card.priceLabel')} unit={t('card.perPersonDay')} />
                    {/* Checkout Katering (docs/arsitektur-booking-engine-v2.md §10.6) — hanya bila ada musim berharga (mesin menolak musim tanpa harga). */}
                    {hasPrice(o.id) && (
                      <Link href={checkoutPath(locale, 'catering', o.id)} className="btn-brand-solid w-full">
                        {t('card.order')} <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </CatalogSection>

      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
