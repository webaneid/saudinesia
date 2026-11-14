import type { LucideIcon } from 'lucide-react'
import { Building2, Bus, KeyRound, MapPin, Package, Plane, Star, UserRound, UtensilsCrossed } from 'lucide-react'

// Satu daftar menu katalog publik, dipakai header desktop, menu HP, dan footer. `key` = kunci pesan `nav.*` (i18n/messages).
export const PUBLIC_NAV: ReadonlyArray<{ key: string; path: string; icon: LucideIcon }> = [
  { key: 'packages',  path: 'packages',  icon: Package },
  { key: 'haji',      path: 'haji',      icon: Star },
  { key: 'visa',      path: 'visa',      icon: KeyRound },
  { key: 'flight',    path: 'flight',    icon: Plane },
  { key: 'hotels',    path: 'hotels',    icon: Building2 },
  { key: 'transport', path: 'transport', icon: Bus },
  { key: 'muthowif',  path: 'muthowif',  icon: UserRound },
  { key: 'tours',     path: 'tours',     icon: MapPin },
  { key: 'catering',  path: 'catering',  icon: UtensilsCrossed },
]
