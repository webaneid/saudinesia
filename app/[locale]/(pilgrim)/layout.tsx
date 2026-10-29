import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { getOnboardingState, isOnboardingComplete } from '@/lib/auth/contact'
import { safeLocale } from '@/lib/utils/locale'
import { LayoutDashboard, FileText, UserRound, Plus } from 'lucide-react'

type Props = {
  children: React.ReactNode
  params:   Promise<{ locale: string }>
}

export default async function PilgrimLayout({ children, params }: Props) {
  const { locale } = await params
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)

  // Gerbang "Lengkapi data" (docs/arsitektur-auth.md §3.5): jamaah wajib mengisi telepon + WhatsApp dan memberi persetujuan (privasi + WhatsApp) sebelum halaman lain. Dicek di sini
  // (Server Component, punya Prisma) — middleware berjalan di Edge tanpa DB. Staf tidak terkena.
  if (session.role === 'pilgrim') {
    const state = await getOnboardingState(session.userId)
    if (state && !isOnboardingComplete(state)) redirect(`/${safeLocale(locale)}/lengkapi-data`)
  }

  const navItems = [
    { href: `/${locale}/dashboard`, icon: LayoutDashboard, label: 'Dashboard' },
    // Wizard 7-langkah lama dihapus (docs/decisions.md 2026-07-25) — arahkan ke hub katalog
    // publik sampai checkout pengganti per-produk (hotel/muthowif/catering/tourPackage) dibangun.
    { href: `/${locale}`, icon: Plus, label: 'Buat Booking' },
    { href: `/${locale}/profile`, icon: UserRound, label: 'Profil' },
  ]

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      {/* Pilgrim nav */}
      <nav className="flex items-center gap-1 border-b pb-4">
        {navItems.map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <Icon className="h-3.5 w-3.5" />{label}
          </Link>
        ))}
        <form action={`/api/v1/auth/logout`} method="POST" className="ml-auto">
          <button type="submit" className="text-xs text-muted-foreground hover:text-destructive transition-colors">
            Keluar
          </button>
        </form>
      </nav>
      {children}
    </div>
  )
}
