import { prisma } from '@/lib/db'
import { MANAGER_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { formatRupiah } from '@/lib/utils'
import { BookOpen, CreditCard, FileText, Clock, Package, Star, KeyRound, Building2 } from 'lucide-react'
import Link from 'next/link'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { bookingWhere, displayStatusOf, statusSelect } from '@/lib/booking/lifecycle'
import { BOOKING_TONE } from '@/lib/admin/statusTone'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Card } from '@/components/admin/ui/Card'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { startOfDayInApp, todayInApp } from '@/lib/time'

type Props = { params: Promise<{ locale: string }> }

export default async function AdminOverview({ params }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  const isManager = MANAGER_ROLES.includes(session.role)

  const [pendingPayment, paymentReview, pendingVisa, confirmedToday] = await Promise.all([
    prisma.booking.count({ where: bookingWhere.awaiting_payment }),
    prisma.booking.count({ where: bookingWhere.payment_review }),
    prisma.visaApplication.count({ where: { status: 'pending_documents' } }),
    prisma.booking.count({
      where: { ...bookingWhere.confirmed, confirmedAt: { gte: startOfDayInApp(todayInApp()) } }, // dikonfirmasi HARI INI = `confirmedAt` hari ini (bukan updatedAt)
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
    include: { user: { select: { fullName: true } }, _count: { select: { pilgrims: true } }, payments: statusSelect.payments },
  })

  type RecentRow = (typeof recentBookings)[number]
  const recentColumns: Column<RecentRow>[] = [
    { key: 'code', header: 'Kode', mobile: 'title', cell: b => <Link href={`/${locale}/admin/bookings/${b.id}`} className="font-mono text-[12px] font-semibold text-admin-accent-strong hover:text-admin-accent">{b.bookingCode}</Link> },
    { key: 'name', header: 'Pemesan', cell: b => <span className="text-[13px] text-admin-ink/80">{b.user.fullName ?? '-'}</span> },
    { key: 'pilgrims', header: 'Jamaah', hideBelowLg: true, cell: b => <span className="text-[12px] text-admin-muted">{b._count.pilgrims} jamaah</span> },
    { key: 'status', header: 'Status', cell: b => { const st = displayStatusOf(b); return <Badge tone={BOOKING_TONE[st] ?? 'neutral'}>{BOOKING_STATUS[st].label}</Badge> } },
    { key: 'actions', header: '', actions: true, cell: b => <RowActions><ActionLink kind="view" href={`/${locale}/admin/bookings/${b.id}`} label={`Lihat booking ${b.bookingCode}`} /></RowActions> },
  ]

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

      {/* Booking terbaru — ringkasan tetap 5 baris (bukan daftar yang tumbuh); daftar lengkap berpaginasi di /admin/bookings */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-bold text-admin-ink">Booking Terbaru</span>
          <Link href={`/${locale}/admin/bookings`} className="text-[12px] text-admin-accent hover:text-admin-accent-strong font-medium transition-colors">
            Lihat semua →
          </Link>
        </div>
        <DataTable columns={recentColumns} rows={recentBookings} getRowId={b => b.id} empty="Belum ada booking." />
      </div>
    </div>
  )
}
