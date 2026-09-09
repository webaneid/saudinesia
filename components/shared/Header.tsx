import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { Building2, Bus, UserRound, UtensilsCrossed, MapPin, Star, KeyRound, Package, Plane } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HeaderProps { locale: string }

export async function Header({ locale }: HeaderProps) {
  const session = await getSession()
  const navLinks = [
    { href: `/${locale}/packages`,  label: 'Paket',        icon: Package },
    { href: `/${locale}/haji`,      label: 'Haji',         icon: Star },
    { href: `/${locale}/visa`,      label: 'Visa',         icon: KeyRound },
    { href: `/${locale}/flight`,    label: 'Pesawat',      icon: Plane },
    { href: `/${locale}/hotels`,    label: 'Hotel',        icon: Building2 },
    { href: `/${locale}/transport`, label: 'Transport',    icon: Bus },
    { href: `/${locale}/muthowif`,  label: 'Muthowif',    icon: UserRound },
    { href: `/${locale}/tours`,     label: 'Ziarah',      icon: MapPin },
  ]
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href={`/${locale}`} className="flex items-center gap-2 font-bold text-primary">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-black">S</div>
          Saudinesia
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Icon className="h-3.5 w-3.5" />{label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {session ? (
            <Button asChild size="sm">
              <Link href={`/${locale}/${["admin","superadmin"].includes(session.role) ? "admin" : "dashboard"}`}>Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm"><Link href={`/${locale}/login`}>Masuk</Link></Button>
              <Button asChild size="sm"><Link href={`/${locale}/register`}>Daftar</Link></Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
