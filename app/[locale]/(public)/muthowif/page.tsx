import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Globe, Tag, UserRound } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireCatalog } from '@/lib/catalog/availability'
import { getFeaturedCardUrls } from '@/lib/media/urls'
import { plainText } from '@/lib/rich-text/doc'
import { getMuthowifServicePrice } from '@/lib/pricing/engine/read'
import { getPageContent, getPageText } from '@/lib/public-content/content'
import { catalogMetadata } from '@/lib/public-content/metadata'
import { formatRupiah } from '@/lib/utils'
import { PageHero, type HeroFact } from '@/components/shared/public/PageHero'
import { PageCta } from '@/components/shared/public/PageCta'
import { CatalogSection } from '@/components/shared/public/CatalogSection'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return catalogMetadata((await params).locale, 'muthowif')
}

// Katalog Muthowif — pola katalog §6.7. Jamaah memesan LAYANAN, admin yang menugaskan (docs/arsitektur-muthowif.md §9), jadi daftar ini
// profil saja. Rating dihapus (G5): angka itu diisi admin, bukan ulasan jamaah — tak boleh tampil sebagai penilaian (K3).
export default async function MuthowifPage({ params }: Props) {
  const { locale } = await params
  await requireCatalog('muthowif')
  const [guides, servicePrice, content, t] = await Promise.all([
    prisma.muthowif.findMany({
      where: { isActive: true },
      select: { id: true, name: true, bio: true, languages: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    getMuthowifServicePrice(),
    getPageContent(locale, 'muthowif'),
    getPageText(locale, 'muthowif'),
  ])
  const photos = await getFeaturedCardUrls('muthowif', guides.map(g => g.id))

  const facts: HeroFact[] = []
  if (guides.length > 0) facts.push({ icon: UserRound, label: t('facts.count', { count: guides.length }) })
  if (servicePrice && servicePrice.price > 0) facts.push({ icon: Tag, label: t('facts.priceFrom', { price: formatRupiah(servicePrice.price) }) })

  return (
    <div className="space-y-14">
      <PageHero locale={locale} content={content.hero} facts={facts} />

      <CatalogSection
        title={t('list.title')}
        description={t('list.description')}
        empty={{ icon: UserRound, text: t('list.empty') }}
        isEmpty={guides.length === 0}
      >
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {guides.map(g => {
            const langs = Array.isArray(g.languages) ? g.languages.filter((l): l is string => typeof l === 'string') : []
            const photo = photos.get(g.id)
            const bio = plainText(g.bio)
            return (
              <Link key={g.id} href={`/${locale}/muthowif/${g.id}`} className="catalog-card group gap-4 p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-light">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- URL presigned MinIO (bucket private), sudah dikecilkan saat unggah
                      <img src={photo} alt={g.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <UserRound className="h-7 w-7 text-brand" aria-hidden />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold leading-snug text-brand-dark">{g.name}</h3>
                </div>

                {bio && <p className="line-clamp-3 text-sm text-muted-foreground">{bio}</p>}

                {langs.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {langs.map(lang => (
                      <li key={lang} className="catalog-chip">
                        <Globe className="h-3 w-3" aria-hidden /> {lang}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="mt-auto inline-flex items-center gap-1.5 border-t pt-4 text-sm font-semibold text-brand group-hover:underline">
                  {t('card.details')} <ArrowRight className="h-4 w-4" aria-hidden />
                </p>
              </Link>
            )
          })}
        </div>
      </CatalogSection>

      <PageCta locale={locale} content={content.cta} />
    </div>
  )
}
