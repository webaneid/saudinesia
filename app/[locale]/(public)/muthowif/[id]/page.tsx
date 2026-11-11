import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { hasLocale } from 'next-intl'
import { prisma } from '@/lib/db'
import { routing } from '@/i18n/routing'
import { getFeaturedUrls } from '@/lib/media/urls'
import { UserRound, Globe, Users, ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatRupiah } from '@/lib/utils'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { plainText } from '@/lib/rich-text/doc'
import { getMuthowifServicePrice } from '@/lib/pricing/engine/read'
import { checkoutPath } from '@/lib/checkout/kinds'
import { requireCatalog } from '@/lib/catalog/availability'
import { getPageText } from '@/lib/public-content/content'
import { localizedAlternates } from '@/lib/seo/site'

type Props = { params: Promise<{ locale: string; id: string }> }

// Profil satu pembimbing (etalase). Muthowif dipesan sebagai LAYANAN umum dan Saudinesia yang menugaskan (docs/arsitektur-muthowif.md §9) —
// karena itu halaman ini TIDAK menampilkan rating (bukan ulasan sungguhan, A7) dan tombolnya memesan layanan, bukan orang ini.
// Teks lewat getPageText (catalog.muthowif.detail), metadata judul = nama pembimbing (audit front-end 2026-11-11, §8).

const findGuide = (id: string) =>
  /^[0-9a-f-]{36}$/i.test(id) ? prisma.muthowif.findUnique({ where: { id, isActive: true }, select: { id: true, name: true, bio: true, languages: true, dailyCapacity: true } }) : null

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params
  if (!hasLocale(routing.locales, locale)) return {}
  const guide = await findGuide(id)
  if (!guide) return {}
  const description = plainText(guide.bio).slice(0, 160)
  return { title: guide.name, ...(description && { description }), alternates: localizedAlternates(locale, `muthowif/${guide.id}`) }
}

export default async function MuthowifDetailPage({ params }: Props) {
  const { locale, id } = await params
  await requireCatalog('muthowif')

  const [guide, servicePrice, t] = await Promise.all([findGuide(id), getMuthowifServicePrice(), getPageText(locale, 'muthowif', 'detail')])
  if (!guide) notFound()

  const langs = Array.isArray(guide.languages) ? (guide.languages as unknown[]).filter((l): l is string => typeof l === 'string') : []
  const photoUrl = (await getFeaturedUrls('muthowif', [guide.id])).get(guide.id) ?? null
  const bookable = !!servicePrice && servicePrice.price > 0

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <Link href={`/${locale}/muthowif`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('back')}
      </Link>

      <article className="space-y-6 rounded-xl border bg-card p-6">
        <div className="flex items-center gap-4">
          <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-light">
            {photoUrl ? (
              <Image src={photoUrl} alt={guide.name} fill className="object-cover" unoptimized />
            ) : (
              <UserRound className="h-8 w-8 text-brand" aria-hidden />
            )}
          </div>
          <h1 className="text-2xl font-bold text-brand-dark">{guide.name}</h1>
        </div>

        <RichTextView value={guide.bio} className="text-base text-muted-foreground" />

        <div className="grid gap-4 sm:grid-cols-2">
          {langs.length > 0 && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-4">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Globe className="h-3.5 w-3.5" aria-hidden /> {t('languages')}</p>
              <div className="flex flex-wrap gap-1.5">
                {langs.map(l => <Badge key={l} variant="outline" className="text-xs">{l}</Badge>)}
              </div>
            </div>
          )}
          <div className="space-y-1 rounded-lg bg-muted/50 p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" aria-hidden /> {t('capacity')}</p>
            <p className="text-lg font-bold">{t('capacityValue', { count: guide.dailyCapacity })}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
          <div>
            {bookable && (
              <>
                <p className="text-sm text-muted-foreground">{t('price')}</p>
                <p className="text-2xl font-bold text-brand">{formatRupiah(servicePrice.price)}</p>
              </>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">{t('assignment', { name: guide.name })}</p>
          </div>
          {/* Checkout satu layanan umum (docs/arsitektur-booking-engine-v2.md §10.6, K11b-3); layanan belum berharga tak dapat dipesan. */}
          {bookable && (
            <Link href={checkoutPath(locale, 'muthowif', servicePrice.id)} className="btn-brand-solid">{t('order')}</Link>
          )}
        </div>
      </article>
    </div>
  )
}
