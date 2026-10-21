import { prisma } from '@/lib/db'
import { getSession, MANAGER_ROLES } from '@/lib/auth/session'
import { formatRupiah } from '@/lib/utils'
import { BookOpen, CreditCard, FileText, Clock, Package, Star, KeyRound, Building2 } from 'lucide-react'
import Link from 'next/link'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { BOOKING_TONE } from '@/lib/admin/statusTone'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Card } from '@/components/admin/ui/Card'
import { Badge } from '@/components/admin/ui/Badge'

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
    { icon: Clock,      label: 'Menunggu Bayar',       value: pendingPayment, href: `/${locale}/admin/bookings?status=awaiting_payment`, tone: 'bg-admin-gold/15 text-admin-gold-strong' },
    { icon: CreditCard, label: 'Verifikasi Bayar',     value: paymentReview,  href: `/${locale}/admin/payments`,                         tone: 'bg-admin-accent/10 text-admin-accent-strong' },
    { icon: FileText,   label: 'Dokumen Visa Kurang',  value: pendingVisa,    href: `/${locale}/admin/visa`,                             tone: 'bg-admin-danger/10 text-admin-danger' },
    { icon: BookOpen,   label: 'Dikonfirmasi Hari Ini', value: confirmedToday, href: `/${locale}/admin/bookings?status=confirmed`,        tone: 'bg-admin-ok/10 text-admin-ok' },
  ]

  const productStatCards = isManager ? [
    { icon: Building2, label: 'Hotel Aktif',  value: activeHotels,   href: `/${locale}/admin/products/hotels`,   tone: 'bg-admin-accent/10 text-admin-accent-strong' },
    { icon: Star,      label: 'Paket Haji',   value: activeHaji,     href: `/${locale}/admin/products/haji`,     tone: 'bg-admin-gold/15 text-admin-gold-strong' },
    { icon: KeyRound,  label: 'Produk Visa',  value: activeVisa,     href: `/${locale}/admin/products/visa`,     tone: 'bg-admin-accent/10 text-admin-accent-strong' },
    { icon: Package,   label: 'Paket Bundle', value: activePackages, href: `/${locale}/admin/products/packages`, tone: 'bg-admin-primary-medium/15 text-admin-primary-medium' },
  ] : []

  const recentBookings = await prisma.booking.findMany({
    orderBy: { createdAt: 'desc' }, take: 8,
    include: { user: { select: { fullName: true } }, _count: { select: { pilgrims: true } } },
  })

  return (
    <div className="space-y-7">
      <PageHeader title="Overview" />

      {/* Operasional */}
      <div>
        <p className="admin-section mb-3">Operasional</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {opsStats.map(s => (
            <Link key={s.href} href={s.href} className="block">
              <Card className="space-y-3 p-5 transition-colors hover:border-admin-line-strong">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${s.tone}`}>
                  <s.icon className="size-[18px]" />
                </span>
                <p className="m-0 text-[28px] font-extrabold leading-none tabular-nums text-admin-ink">{s.value}</p>
                <p className="m-0 text-[12px] text-admin-muted">{s.label}</p>
              </Card>
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
              <Link key={s.href} href={s.href} className="block">
                <Card className="space-y-3 p-5 transition-colors hover:border-admin-line-strong">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${s.tone}`}>
                    <s.icon className="size-[18px]" />
                  </span>
                  <p className="m-0 text-[28px] font-extrabold leading-none tabular-nums text-admin-ink">{s.value}</p>
                  <p className="m-0 text-[12px] text-admin-muted">{s.label}</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent bookings */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-admin-line flex items-center justify-between">
          <span className="text-[14px] font-bold text-admin-ink">Booking Terbaru</span>
          <Link href={`/${locale}/admin/bookings`} className="text-[12px] text-admin-accent hover:text-admin-accent-strong font-medium transition-colors">
            Lihat semua →
          </Link>
        </div>
        <div className="divide-y divide-admin-line">
          {recentBookings.map(b => (
            <Link key={b.id} href={`/${locale}/admin/bookings/${b.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-admin-spot/30 transition-colors text-[13px]">
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-admin-accent-strong text-[12px]">{b.bookingCode}</span>
                <span className="text-admin-ink/80">{b.user.fullName ?? '-'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-admin-muted">{b._count.pilgrims} jamaah</span>
                <Badge tone={BOOKING_TONE[b.status] ?? 'neutral'}>
                  {BOOKING_STATUS[b.status as keyof typeof BOOKING_STATUS]?.label ?? b.status.replace(/_/g, ' ')}
                </Badge>
              </div>
            </Link>
          ))}
          {recentBookings.length === 0 && (
            <p className="px-5 py-10 text-center text-admin-muted/70 text-sm">Belum ada booking.</p>
          )}
        </div>
      </Card>
    </div>
  )
}
