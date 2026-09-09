import { prisma } from '@/lib/db'
import { getSession, MANAGER_ROLES } from '@/lib/auth/session'
import { formatRupiah } from '@/lib/utils'
import { BookOpen, CreditCard, FileText, Clock, Package, Star, KeyRound, Building2 } from 'lucide-react'
import Link from 'next/link'

type Props = { params: Promise<{ locale: string }> }

export default async function AdminOverview({ params }: Props) {
  const { locale } = await params
  const session = await getSession()
  const isManager = MANAGER_ROLES.includes(session?.role ?? 'admin' as never)

  const [pendingPayment, paymentReview, pendingVisa, confirmedToday] = await Promise.all([
    prisma.booking.count({ where: { status: 'awaiting_payment' } }),
    prisma.booking.count({ where: { status: 'payment_review' } }),
    prisma.visaApplication.count({ where: { status: 'pending_documents' } }),
    prisma.booking.count({
      where: { status: 'confirmed', updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
  ])

  const productStats = isManager ? await Promise.all([
    prisma.hotel.count({ where: { isActive: true } }),
    prisma.hajiProduct.count({ where: { isActive: true } }),
    prisma.visaProduct.count({ where: { isActive: true } }),
    prisma.package.count({ where: { isActive: true } }),
  ]) : [0, 0, 0, 0]

  const [activeHotels, activeHaji, activeVisa, activePackages] = productStats

  const opsStats = [
    { icon: Clock,      label: 'Menunggu Bayar',       value: pendingPayment, href: `/${locale}/admin/bookings?status=awaiting_payment`, tone: 'bg-gold-50 text-gold-600' },
    { icon: CreditCard, label: 'Verifikasi Bayar',     value: paymentReview,  href: `/${locale}/admin/payments`,                         tone: 'bg-teal-50 text-teal-700' },
    { icon: FileText,   label: 'Dokumen Visa Kurang',  value: pendingVisa,    href: `/${locale}/admin/visa`,                             tone: 'bg-rose-50 text-rose-600' },
    { icon: BookOpen,   label: 'Dikonfirmasi Hari Ini', value: confirmedToday, href: `/${locale}/admin/bookings?status=confirmed`,        tone: 'bg-mint-50 text-mint-700' },
  ]

  const productStatCards = isManager ? [
    { icon: Building2, label: 'Hotel Aktif',  value: activeHotels,   href: `/${locale}/admin/products/hotels`,   tone: 'bg-teal-50 text-teal-700' },
    { icon: Star,      label: 'Paket Haji',   value: activeHaji,     href: `/${locale}/admin/products/haji`,     tone: 'bg-gold-50 text-gold-600' },
    { icon: KeyRound,  label: 'Produk Visa',  value: activeVisa,     href: `/${locale}/admin/products/visa`,     tone: 'bg-teal-50 text-teal-700' },
    { icon: Package,   label: 'Paket Bundle', value: activePackages, href: `/${locale}/admin/products/packages`, tone: 'bg-purple-50 text-purple-700' },
  ] : []

  const recentBookings = await prisma.booking.findMany({
    orderBy: { createdAt: 'desc' }, take: 8,
    include: { user: { select: { fullName: true } }, _count: { select: { pilgrims: true } } },
  })

  const STATUS_BADGE: Record<string, string> = {
    payment_review:   'admin-badge-blue',
    awaiting_payment: 'admin-badge-amber',
    confirmed:        'admin-badge-green',
    cancelled:        'admin-badge-red',
  }

  return (
    <div className="space-y-7 max-w-5xl">
      <h1 className="admin-h1">Overview</h1>

      {/* Operasional */}
      <div>
        <p className="admin-section mb-3">Operasional</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {opsStats.map(s => (
            <Link key={s.href} href={s.href}
              className="admin-card p-5 space-y-3 hover:shadow-card transition-shadow block">
              <span className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${s.tone}`}>
                <s.icon className="h-[18px] w-[18px]" />
              </span>
              <p className="text-[28px] font-extrabold tabular-nums text-ink leading-none">{s.value}</p>
              <p className="text-[12px] text-slate-500">{s.label}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Produk — manager+ */}
      {isManager && (
        <div>
          <p className="admin-section mb-3">Produk Aktif</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {productStatCards.map(s => (
              <Link key={s.href} href={s.href}
                className="admin-card p-5 space-y-3 hover:shadow-card transition-shadow block">
                <span className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${s.tone}`}>
                  <s.icon className="h-[18px] w-[18px]" />
                </span>
                <p className="text-[28px] font-extrabold tabular-nums text-ink leading-none">{s.value}</p>
                <p className="text-[12px] text-slate-500">{s.label}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent bookings */}
      <div className="admin-card overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <span className="text-[14px] font-bold text-ink">Booking Terbaru</span>
          <Link href={`/${locale}/admin/bookings`} className="text-[12px] text-teal-600 hover:text-teal-700 font-medium transition-colors">
            Lihat semua →
          </Link>
        </div>
        <div className="divide-y divide-line">
          {recentBookings.map(b => (
            <Link key={b.id} href={`/${locale}/admin/bookings/${b.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-canvas/40 transition-colors text-[13px]">
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-teal-700 text-[12px]">{b.bookingCode}</span>
                <span className="text-ink2">{b.user.fullName ?? '-'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-slate-500">{b._count.pilgrims} jamaah</span>
                <span className={STATUS_BADGE[b.status] ?? 'admin-badge-gray'}>
                  {b.status.replace(/_/g, ' ')}
                </span>
              </div>
            </Link>
          ))}
          {recentBookings.length === 0 && (
            <p className="px-5 py-10 text-center text-slate-400 text-sm">Belum ada booking.</p>
          )}
        </div>
      </div>
    </div>
  )
}
