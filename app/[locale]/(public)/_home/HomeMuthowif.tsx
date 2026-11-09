import Link from 'next/link'
import { getPageText } from '@/lib/public-content/content'
import { ArrowRight, UserRound } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'

// Tanpa daftar nama: jamaah memesan layanannya, Saudinesia yang menugaskan orangnya (docs/arsitektur-muthowif.md §9).
export async function HomeMuthowif({ locale, pricePerDay }: { locale: string; pricePerDay: number | null }) {
  if (pricePerDay === null) return null
  const t = await getPageText(locale, 'home', 'muthowif')
  return (
    <section className="flex flex-col gap-5 rounded-3xl bg-brand-light p-6 md:flex-row md:items-center md:justify-between md:p-10">
      <div className="flex items-start gap-4">
        <span className="inline-flex shrink-0 rounded-xl bg-white p-3 text-brand">
          <UserRound className="h-6 w-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-brand-dark">{t('title')}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{t('description')}</p>
          <p className="pt-1 text-sm font-semibold text-brand">
            {t('priceFrom')} {formatRupiah(pricePerDay)}
            <span className="text-xs font-normal text-muted-foreground"> {t('perDay')}</span>
          </p>
        </div>
      </div>
      <Link href={`/${locale}/muthowif`} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
        {t('details')} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  )
}
