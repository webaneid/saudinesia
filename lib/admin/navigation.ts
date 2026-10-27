import {
  LayoutDashboard, BookOpen, CreditCard, FileText, BarChart3, Bell,
  Package, Star, KeyRound, Building2, Bus, UserRound, UtensilsCrossed, MapPin, Landmark, CalendarDays, Plane,
  Users, Settings, ShieldAlert, Handshake, HeartPulse, LineChart,
  type LucideIcon,
} from 'lucide-react'

export type NavItem  = { path: string; icon: LucideIcon; label: string }
export type NavGroup = { label: string; items: NavItem[] }

/** `path` relatif terhadap `/{locale}` — Sidebar yang menambahkan prefix locale. */
const OPERASIONAL: NavItem[] = [
  { path: '/admin',               icon: LayoutDashboard, label: 'Overview' },
  { path: '/admin/bookings',      icon: BookOpen,        label: 'Booking' },
  { path: '/admin/payments',      icon: CreditCard,      label: 'Pembayaran' },
  { path: '/admin/visa',          icon: FileText,        label: 'Visa Status' },
  { path: '/admin/quotas',        icon: BarChart3,       label: 'Quota' },
  { path: '/admin/margin',        icon: HeartPulse,      label: 'Kesehatan Margin' },
  { path: '/admin/reports',       icon: LineChart,       label: 'Laporan Untung' },
  { path: '/admin/notifications', icon: Bell,            label: 'Notifikasi' },
]

const PRODUK: NavItem[] = [
  { path: '/admin/products/packages',      icon: Package,         label: 'Paket' },
  { path: '/admin/products/haji',          icon: Star,            label: 'Haji' },
  { path: '/admin/products/visa',          icon: KeyRound,        label: 'Visa Produk' },
  { path: '/admin/products/flight',        icon: Plane,           label: 'Pesawat' },
  { path: '/admin/products/hotels',        icon: Building2,       label: 'Hotel' },
  { path: '/admin/products/transport',     icon: Bus,             label: 'Transport' },
  { path: '/admin/products/muthowif',      icon: UserRound,       label: 'Muthowif' },
  { path: '/admin/products/catering',      icon: UtensilsCrossed, label: 'Katering' },
  { path: '/admin/products/tourism-sites', icon: MapPin,          label: 'Situs Wisata' },
  { path: '/admin/products/tour-packages', icon: Landmark,        label: 'Paket Ziarah' },
  { path: '/admin/products/seasons',       icon: CalendarDays,    label: 'Musim' },
]

const SISTEM: NavItem[] = [
  { path: '/admin/system/users',             icon: Users,       label: 'Pengguna' },
  { path: '/admin/system/vendors',           icon: Handshake,   label: 'Vendor' },
  { path: '/admin/system/deletion-requests', icon: ShieldAlert, label: 'Hapus Akun' },
  { path: '/admin/system/settings',          icon: Settings,    label: 'Pengaturan' },
]

/** Grup menu sesuai role: OPERASIONAL semua admin, PRODUK manager+, SISTEM superadmin saja. */
export function getAdminNavigation({ isManager, isSuperAdmin }: { isManager: boolean; isSuperAdmin: boolean }): NavGroup[] {
  return [
    { label: 'Operasional', items: OPERASIONAL },
    ...(isManager ? [{ label: 'Produk', items: PRODUK }] : []),
    ...(isSuperAdmin ? [{ label: 'Sistem', items: SISTEM }] : []),
  ]
}

/** Label breadcrumb per segmen URL. Segmen yang tidak ada di sini di-title-case; UUID jadi "Detail". */
export const LABEL_SEGMEN: Record<string, string> = {
  admin: 'Admin',
  bookings: 'Booking',
  payments: 'Pembayaran',
  visa: 'Visa',
  quotas: 'Quota',
  margin: 'Kesehatan Margin',
  reports: 'Laporan Untung',
  notifications: 'Notifikasi',
  products: 'Produk',
  packages: 'Paket',
  haji: 'Haji',
  flight: 'Pesawat',
  hotels: 'Hotel',
  transport: 'Transport',
  trips: 'Trip',
  vehicles: 'Kendaraan',
  muthowif: 'Muthowif',
  catering: 'Katering',
  'tourism-sites': 'Situs Wisata',
  'tour-packages': 'Paket Ziarah',
  seasons: 'Musim',
  system: 'Sistem',
  users: 'Pengguna',
  'deletion-requests': 'Hapus Akun',
  vendors: 'Vendor',
  categories: 'Kategori',
  new: 'Baru',
  settings: 'Pengaturan',
}

/** Segmen yang tidak punya halaman sendiri (hanya folder pengelompok) — di breadcrumb tampil sebagai teks, bukan tautan. */
export const SEGMEN_TANPA_HALAMAN = new Set(['products', 'system', 'trips', 'vehicles'])
