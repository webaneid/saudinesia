import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { yearInApp } from '@/lib/time'
import { availableCatalogs } from '@/lib/catalog/availability'
import { PUBLIC_NAV } from './publicNav'

// Kontak dan identitas badan usaha ditambahkan setelah pemilik memberi datanya (docs/arsitektur-frontend-publik.md §5) — tidak ada data karangan.
export async function PublicFooter({ locale }: { locale: string }) {
  const nav = await getTranslations({ locale, namespace: 'nav' })
  const t = await getTranslations({ locale, namespace: 'footer' })
  const linkClass = 'text-sm text-brand-light/75 transition-colors hover:text-white'
  const headingClass = 'text-sm font-semibold text-white'
  // Hanya layanan yang punya produk aktif (§7); Katering hanya di footer, bukan menu utama.
  const available = await availableCatalogs()
  const services = [...PUBLIC_NAV.map(n => n.key), 'catering'].filter(k => available.has(k))

  return (
    <footer className="mt-16 bg-brand-dark text-brand-light">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:grid-cols-4">
        <div className="space-y-2">
          <Link href={`/${locale}`} className="text-lg font-bold text-white">Saudinesia</Link>
          <p className="text-sm text-brand-light/75">{t('tagline')}</p>
        </div>
        {services.length > 0 && (
          <div className="space-y-3 md:col-span-1">
            <p className={headingClass}>{t('services')}</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
              {services.map(key => (
                <li key={key}><Link href={`/${locale}/${key}`} className={linkClass}>{nav(key)}</Link></li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-3">
          <p className={headingClass}>{t('account')}</p>
          <ul className="space-y-2">
            <li><Link href={`/${locale}/login`} className={linkClass}>{nav('login')}</Link></li>
            <li><Link href={`/${locale}/register`} className={linkClass}>{nav('register')}</Link></li>
          </ul>
        </div>
        <div className="space-y-3">
          <p className={headingClass}>{t('info')}</p>
          <ul className="space-y-2">
            <li><Link href={`/${locale}/privacy`} className={linkClass}>{t('privacy')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-brand-light/15">
        <p className="mx-auto max-w-7xl px-4 py-4 text-xs text-brand-light/60">© {yearInApp()} Saudinesia. {t('rights')}</p>
      </div>
    </footer>
  )
}
