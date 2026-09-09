import { prisma } from '@/lib/db'
import Link from 'next/link'
import { formatRupiah } from '@/lib/utils'

type Props = { params: Promise<{ locale: string }> }

export default async function AdminPayments({ params }: Props) {
  const { locale } = await params

  const bookings = await prisma.booking.findMany({
    where: { status: 'payment_review' },
    orderBy: { updatedAt: 'desc' },
    include: {
      user:     { select: { fullName: true, phone: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count:   { select: { pilgrims: true } },
    },
  })

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="admin-h1">Antrean Verifikasi Pembayaran</h1>
        <p className="text-sm text-slate-500 mt-1">{bookings.length} booking menunggu konfirmasi</p>
      </div>

      {bookings.length === 0 ? (
        <div className="admin-card p-12 text-center text-slate-400 text-sm">
          Tidak ada pembayaran yang perlu dikonfirmasi.
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => {
            const payment = b.payments[0]
            return (
              <Link key={b.id} href={`/${locale}/admin/bookings/${b.id}`}
                className="admin-card flex items-center justify-between p-4 hover:shadow-card transition-shadow gap-4 block">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[12px] font-semibold text-teal-700">{b.bookingCode}</span>
                    <span className="text-[13px] text-ink font-medium">{b.user.fullName}</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {b._count.pilgrims} jamaah ·{' '}
                    {payment?.buktiTransferUploadedAt
                      ? `Bukti diupload ${new Date(payment.buktiTransferUploadedAt).toLocaleString('id-ID')}`
                      : 'Belum ada bukti'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-ink tabular-nums">{formatRupiah(Number(b.totalAmount))}</p>
                  <p className="text-[11px] text-teal-600 font-medium mt-0.5">→ Konfirmasi</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
