import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { formatRupiah } from '@/lib/utils'
import { billOf, billSelect } from '@/lib/invoice/bill'
import { Plus, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { STATUS_FILTERS, displayStatusOf, statusSelect, statusWhere, type StatusFilter } from '@/lib/booking/lifecycle'
import type { BookingStatus, Prisma } from '@prisma/client'
import { buildListHref, paginate, parseListParams } from '@/lib/table/pagination'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { FilterBar } from '@/components/shared/data-table/FilterBar'
import { FilterSelect } from '@/components/shared/data-table/FilterSelect'
import { Pagination } from '@/components/shared/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/shared/data-table/RowActions'
import { formatCalendarDate } from '@/lib/time'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type BookingRow = Prisma.BookingGetPayload<{ include: { _count: { select: { pilgrims: true } }; payments: { select: { id: true } }; invoice: { select: { taxAddedIdr: true; taxIncludedIdr: true } } } }>

// Draf adalah urusan admin (belum diterbitkan) — tak pernah tampil ke jamaah, juga bukan pilihan filter.
const PILGRIM_STATUS_FILTERS = STATUS_FILTERS.filter(s => s !== 'draft')
const isPilgrimFilter = (v: string | undefined): v is StatusFilter => !!v && (PILGRIM_STATUS_FILTERS as readonly string[]).includes(v)

export default async function DashboardPage({ params, searchParams }: Props) {
  const { locale } = await params
  const sp = await searchParams
  const list = parseListParams(sp, 10)
  const rawStatus = typeof sp.status === 'string' ? sp.status : undefined
  const status = isPilgrimFilter(rawStatus) ? rawStatus : undefined
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { fullName: true, email: true, phone: true, whatsapp: true, whatsappVerifiedAt: true, verifiedWhatsapp: true },
  })

  // Jumlah SELURUH booking pemilik (tanpa filter) menentukan tampilan "belum ada booking"; daftar sendiri berpaginasi + filter status.
  const ownBookings = await prisma.booking.count({ where: { userId: session.userId, status: { not: 'draft' } } })
  const where: Prisma.BookingWhereInput = { userId: session.userId, status: { not: 'draft' }, ...(status ? { AND: [statusWhere(status)] } : {}) }
  const { items: bookings, meta } = await paginate<BookingRow>(
    list,
    () => prisma.booking.count({ where }),
    range => prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // id = tie-breaker: createdAt bisa kembar, halaman harus stabil
      include: { _count: { select: { pilgrims: true } }, payments: statusSelect.payments, invoice: billSelect.invoice },
      ...range,
    }),
  )

  const base = `/${locale}/dashboard`
  const limitParam = sp.limit === undefined ? undefined : String(list.limit)
  const columns: Column<BookingRow>[] = [
    { key: 'code', header: 'Kode', mobile: 'title', cell: b => <Link href={`/${locale}/bookings/${b.id}`} className="font-mono text-[13px] font-bold text-primary hover:underline">{b.bookingCode}</Link> },
    { key: 'departure', header: 'Berangkat', cell: b => <span className="text-[13px] text-muted-foreground">{b.departureDate ? formatCalendarDate(b.departureDate) : '-'}</span> },
    { key: 'pilgrims', header: 'Jamaah', hideBelowLg: true, cell: b => <span className="text-[13px] text-muted-foreground">{b._count.pilgrims} jamaah</span> },
    { key: 'total', header: 'Total', align: 'right', cell: b => <span className="text-[13px] font-bold tabular-nums">{formatRupiah(billOf({ totalAmount: b.totalAmount, invoice: b.invoice }).grandTotal)}</span> },
    {
      key: 'status', header: 'Status',
      cell: b => {
        const cfg = BOOKING_STATUS[displayStatusOf(b)]
        return <Badge variant={cfg.badge as 'warning' | 'secondary' | 'success' | 'default' | 'destructive' | 'muted'}>{cfg.label}</Badge>
      },
    },
    { key: 'actions', header: '', actions: true, cell: b => <RowActions><ActionLink kind="view" href={`/${locale}/bookings/${b.id}`} label={`Lihat booking ${b.bookingCode}`} /></RowActions> },
  ]

  return (
    <div className="space-y-8">
      {/* Ajakan verifikasi WhatsApp — TIDAK menghalangi apa pun; email tetap kanal notifikasi (ADR-0002) */}
      {user?.whatsapp && !(user.whatsappVerifiedAt && user.verifiedWhatsapp === user.whatsapp) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>Nomor WhatsApp Anda belum terverifikasi. Verifikasi agar notifikasi juga sampai lewat WhatsApp — email tetap dikirim.</span>
          <Link href={`/${safeLocale(locale)}/profile#verifikasi-whatsapp`} className="font-semibold underline">Verifikasi sekarang</Link>
        </div>
      )}

      {/* Greeting */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Selamat datang, {user?.fullName?.split(' ')[0] ?? 'Jamaah'}</h1>
          <p className="text-muted-foreground">{user?.email}</p>
        </div>
        <Button asChild>
          {/* Wizard 7-langkah lama dihapus (docs/decisions.md 2026-07-25) — arahkan ke hub
              katalog publik sampai checkout pengganti per-produk dibangun. */}
          <Link href={`/${locale}`}>
            <Plus className="mr-2 h-4 w-4" /> Buat Booking Baru
          </Link>
        </Button>
      </div>

      {/* Booking list */}
      {ownBookings === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <FileText className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold">Belum ada booking</p>
            <p className="text-sm text-muted-foreground mt-1">Mulai rencanakan perjalanan umrah Anda</p>
          </div>
          <Button asChild>
            {/* Wizard 7-langkah lama dihapus (docs/decisions.md 2026-07-25) — arahkan ke hub
              katalog publik sampai checkout pengganti per-produk dibangun. */}
          <Link href={`/${locale}`}>Buat Booking Pertama</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Riwayat Booking</h2>
          <FilterBar active={Boolean(status)} resetHref={buildListHref(base, { limit: limitParam })}>
            <FilterSelect label="Status" value={status ?? ''} options={Object.entries(BOOKING_STATUS).filter(([value]) => value !== 'draft').map(([value, v]) => ({ value, label: v.label }))} nav={{ base, param: 'status', query: { limit: limitParam } }} />
          </FilterBar>
          <DataTable
            columns={columns} rows={bookings} getRowId={b => b.id} empty="Tidak ada booking dengan status ini."
            footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => buildListHref(base, { status, limit: limitParam, page })} /> : undefined}
          />
        </div>
      )}
    </div>
  )
}
