import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { formatRupiah } from '@/lib/utils'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { requireAdminPage } from '@/lib/auth/pageGuards'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type QueueRow = Prisma.BookingGetPayload<{
  include: {
    user: { select: { fullName: true; phone: true } }
    payments: true
    _count: { select: { pilgrims: true } }
  }
}>

export default async function AdminPayments({ params, searchParams }: Props) {
  const { locale } = await params
  await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp)

  const where: Prisma.BookingWhereInput = { status: 'payment_review' }

  const { items: bookings, meta } = await paginate<QueueRow>(
    list,
    () => prisma.booking.count({ where }),
    range => prisma.booking.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // id = tie-breaker: updatedAt bisa kembar, halaman harus stabil
      ...range,
      include: {
        user:     { select: { fullName: true, phone: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count:   { select: { pilgrims: true } },
      },
    }),
  )

  const hrefFor = (page: number) =>
    buildListHref(`/${locale}/admin/payments`, { page, limit: sp.limit === undefined ? undefined : list.limit })

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Antrean Verifikasi Pembayaran" description={`${meta.total} booking menunggu konfirmasi`} />

      {bookings.length === 0 ? (
        <div className="kartu p-12 text-center text-sm text-admin-muted">
          Tidak ada pembayaran yang perlu dikonfirmasi.
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {bookings.map(b => {
              const payment = b.payments[0]
              return (
                <Link
                  key={b.id}
                  href={`/${locale}/admin/bookings/${b.id}`}
                  className="kartu flex items-center justify-between gap-4 p-4 transition-shadow hover:shadow-admin"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                      <span className="font-mono text-[12px] font-semibold text-admin-accent">{b.bookingCode}</span>
                      <span className="truncate text-[13px] font-medium">{b.user.fullName}</span>
                    </div>
                    <p className="m-0 text-[11px] text-admin-muted">
                      {b._count.pilgrims} jamaah ·{' '}
                      {payment?.buktiTransferUploadedAt
                        ? `Bukti diupload ${new Date(payment.buktiTransferUploadedAt).toLocaleString('id-ID')}`
                        : 'Belum ada bukti'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="m-0 font-bold tabular-nums">{formatRupiah(Number(b.totalAmount))}</p>
                    <p className="m-0 mt-0.5 text-[11px] font-medium text-admin-accent">→ Konfirmasi</p>
                  </div>
                </Link>
              )
            })}
          </div>
          <Pagination {...meta} hrefFor={hrefFor} />
        </>
      )}
    </div>
  )
}
