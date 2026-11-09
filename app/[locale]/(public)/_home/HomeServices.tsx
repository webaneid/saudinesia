import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getPageText } from '@/lib/public-content/content'
import { availableCatalogs } from '@/lib/catalog/availability'
import { PUBLIC_NAV } from '@/components/shared/publicNav'
import { HomeSectionHeader } from './HomeSectionHeader'

export async function HomeServices({ locale }: { locale: string }) {
  const available = await availableCatalogs()
  // Hanya layanan yang punya produk aktif (§7); tak ada satu pun = bagian ini tidak tampil.
  const items = PUBLIC_NAV.filter(n => available.has(n.key))
  if (items.length === 0) return null
  const t = await getPageText(locale, 'home', 'services')
  const nav = await getTranslations({ locale, namespace: 'nav' })
  return (
    <section className="space-y-6">
      <HomeSectionHeader title={t('title')} description={t('description')} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map(({ key, path, icon: Icon }) => (
          <Link
            key={key}
            href={`/${locale}/${path}`}
            className="group space-y-3 rounded-2xl border bg-card p-4 transition-colors hover:border-brand"
          >
            <span className="inline-flex rounded-xl bg-brand-light p-2.5 text-brand">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="block">
              <span className="block text-sm font-semibold text-brand-dark">{nav(key)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(`items.${key}`)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
