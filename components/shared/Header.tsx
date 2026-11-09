import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/auth/session'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { Button } from '@/components/ui/button'
import { PublicMobileNav } from './PublicMobileNav'
import { availableCatalogs } from '@/lib/catalog/availability'
import { PUBLIC_NAV } from './publicNav'

interface HeaderProps { locale: string }

export async function Header({ locale }: HeaderProps) {
  const session = await getSession()
  const t = await getTranslations({ locale, namespace: 'nav' })
  // Hanya layanan yang punya produk aktif (docs/arsitektur-frontend-publik.md §7).
  const available = await availableCatalogs()
  const items = PUBLIC_NAV.filter(n => available.has(n.key))
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4">
        <Link href={`/${locale}`} className="flex items-center gap-2 font-bold text-primary">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-black">S</div>
          Saudinesia
        </Link>
        <nav className="hidden items-center gap-1 xl:flex" aria-label={t('mainMenu')}>
          {items.map(({ key, path, icon: Icon }) => (
            <Link key={key} href={`/${locale}/${path}`}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Icon className="h-3.5 w-3.5" aria-hidden />{t(key)}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          {session ? (
            <Button asChild size="sm">
              <Link href={`/${locale}/${ADMIN_ROLES.includes(session.role) ? 'admin' : 'dashboard'}`}>{t('dashboard')}</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm"><Link href={`/${locale}/login`}>{t('login')}</Link></Button>
              <Button asChild size="sm"><Link href={`/${locale}/register`}>{t('register')}</Link></Button>
            </>
          )}
          {items.length > 0 && <PublicMobileNav locale={locale} keys={items.map(n => n.key)} />}
        </div>
      </div>
    </header>
  )
}
