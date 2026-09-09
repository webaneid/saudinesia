import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { template: '%s — Saudinesia', default: 'Saudinesia' },
  description: 'Platform layanan Umrah & Haji terpadu untuk jamaah Indonesia',
  manifest: '/manifest.json',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning className={jakarta.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  )
}
