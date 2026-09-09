import { prisma } from '@/lib/db'
import Link from 'next/link'
import { formatRupiah } from '@/lib/utils'
import { BOOKING_STATUS } from '@/lib/constants/booking'

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string; q?: string }> }

export default async function AdminBookings({ params, searchParams }: Props) {
  const { locale } = await params
  const { status, q } = await searchParams

  const bookings = await prisma.booking.findMany({
    where: {
      status: status ? (status as import('@prisma/client').BookingStatus) : undefined,
      OR: q ? [
        { bookingCode: { contains: q, mode: 'insensitive' } },
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
      ] : undefined,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { fullName: true, phone: true } }, _count: { select: { pilgrims: true } } },
  })

  const statuses = Object.keys(BOOKING_STATUS)

  const STATUS_BADGE: Record<string, string> = {
    payment_review:   'admin-badge-blue',
    awaiting_payment: 'admin-badge-amber',
    confirmed:        'admin-badge-green',
    cancelled:        'admin-badge-red',
    documents_pending:'admin-badge-gray',
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <h1 className="admin-h1">Daftar Booking</h1>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        <Link href={`/${locale}/admin/bookings`}
          className={!status ? 'admin-pill-on' : 'admin-pill-off'}>
          Semua
        </Link>
        {statuses.map(s => (
          <Link key={s} href={`/${locale}/admin/bookings?status=${s}`}
            className={status === s ? 'admin-pill-on' : 'admin-pill-off'}>
            {BOOKING_STATUS[s as keyof typeof BOOKING_STATUS]?.label}
          </Link>
        ))}
      </div>

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60">
            <tr>
              <th className="admin-th">Kode</th>
              <th className="admin-th">Jamaah</th>
              <th className="admin-th hidden md:table-cell">Berangkat</th>
              <th className="admin-th hidden lg:table-cell">Total</th>
              <th className="admin-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {bookings.map(b => {
              const cfg = BOOKING_STATUS[b.status as keyof typeof BOOKING_STATUS]
              return (
                <tr key={b.id} className="hover:bg-canvas/40 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/${locale}/admin/bookings/${b.id}`}
                      className="font-mono text-[12px] font-semibold text-teal-700 hover:text-teal-800">
                      {b.bookingCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink font-medium text-[13px]">{b.user.fullName ?? '-'}</div>
                    <div className="text-[11px] text-slate-500">{b._count.pilgrims} jamaah</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-[12px] hidden md:table-cell">
                    {new Date(b.departureDate).toLocaleDateString('id-ID', { dateStyle: 'medium' })}
                  </td>
                  <td className="px-4 py-3 text-ink2 font-medium text-[12px] hidden lg:table-cell tabular-nums">
                    {formatRupiah(Number(b.totalAmount))}
                  </td>
                  <td className="px-4 py-3">
                    <span className={STATUS_BADGE[b.status] ?? 'admin-badge-gray'}>
                      {cfg?.label ?? b.status}
                    </span>
                  </td>
                </tr>
              )
            })}
            {bookings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-sm">
                  Tidak ada booking ditemukan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
