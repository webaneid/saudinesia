import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { getLocale } from 'next-intl/server'
import { siteOrigin } from '@/lib/seo/site'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: { template: '%s — Saudinesia', default: 'Saudinesia' },
  description: 'Platform layanan Umroh dan Haji terpadu untuk jamaah Indonesia',
  manifest: '/manifest.json',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Locale tervalidasi dari i18n/request.ts (daftar di i18n/routing.ts); di luar rute locale jatuh ke bawaan.
  const locale = await getLocale()
  return (
    <html lang={locale} suppressHydrationWarning className={jakarta.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  )
}
