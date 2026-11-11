'use client'

import { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Languages } from 'lucide-react'
import { routing, type AppLocale } from '@/i18n/routing'
import { LOCALE_LABEL, switchLocalePath } from '@/lib/i18n/switch'
import { cn } from '@/lib/utils'

// Pengalih bahasa (docs/arsitektur-i18n-frontend.md §3.1, K3): halaman yang SAMA di bahasa lain, tanpa bendera (bendera ≠ bahasa).
// Tautan biasa `<a>` (muat ulang penuh), bukan navigasi lunak: `<html lang>` dan pesan dibaca di layout akar yang tak dirender ulang saat
// navigasi lunak. Pilihan bahasa diingat lewat URL saja (K2) — tak ada cookie. Alamat HANYA lewat `switchLocalePath`.

type Props = { className?: string; tone?: 'default' | 'onDark' }

function Links({ className, tone = 'default', search }: Props & { search: string }) {
  const t = useTranslations('nav')
  const current = useLocale() as AppLocale
  const pathname = usePathname()
  return (
    <nav aria-label={t('language')} className={cn('flex items-center gap-1 text-xs font-semibold', className)}>
      <Languages className={cn('h-3.5 w-3.5', tone === 'onDark' ? 'text-brand-light/75' : 'text-muted-foreground')} aria-hidden />
      {routing.locales.map(l => {
        const active = l === current
        return (
          <a
            key={l}
            href={switchLocalePath(pathname, search, l)}
            hrefLang={l}
            lang={l}
            aria-current={active ? 'true' : undefined}
            aria-label={LOCALE_LABEL[l].name}
            className={cn(
              'rounded px-1.5 py-1 transition-colors',
              tone === 'onDark'
                ? active ? 'bg-brand-light/15 text-brand-light' : 'text-brand-light/70 hover:text-brand-light'
                : active ? 'bg-brand-light text-brand-dark' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {LOCALE_LABEL[l].short}
          </a>
        )
      })}
    </nav>
  )
}

function WithQuery(props: Props) {
  const search = useSearchParams().toString()
  return <Links {...props} search={search} />
}

export function LocaleSwitcher(props: Props) {
  // useSearchParams butuh batas Suspense; sebelum query terbaca, tautan tetap berfungsi (tanpa query).
  return (
    <Suspense fallback={<Links {...props} search="" />}>
      <WithQuery {...props} />
    </Suspense>
  )
}
