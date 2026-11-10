import React from 'react'
import { OrderSummaryCard, type SummarySection } from './OrderSummaryCard'
import { collapseRows, type SummaryInput } from '@/lib/booking/orderSummary'
import { PaymentProofUpload } from './PaymentProofUpload'
import { safeLocale } from '@/lib/utils/locale'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { formatRupiah } from '@/lib/utils'
import { billOf } from '@/lib/invoice/bill'
import { payableBanks } from '@/lib/invoice/banks'
import { itemSellTotals } from '@/lib/pricing/engine/snapshot'
import type { BankSnapshot } from '@/lib/invoice/issue'
import { AlertCircle, ArrowLeft, Building2, Bus, CheckCircle, Clock, FileDown, Landmark, Package, Plane, Stamp, UserRound, UtensilsCrossed } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { displayStatus } from '@/lib/booking/lifecycle'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { getPaymentConfig } from '@/lib/constants/payment'
import { BOOKING_PILGRIM_SAFE_SELECT } from '@/lib/pilgrims/bookingLink'
import { bookingPilgrimSlots } from '@/lib/pilgrims/slots'
import { PilgrimSlotsTable } from '@/components/shared/pilgrims/PilgrimSlotsTable'
import { DATETIME_FULL, DATE_LONG, DATE_NUMERIC, formatCalendarDate, formatInstant } from '@/lib/time'

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ baru?: string }> }

export default async function BookingDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params
  const justBooked = (await searchParams).baru === '1' // datang dari checkout (docs/arsitektur-booking-engine-v2.md §10.5)
  const { banks } = getPaymentConfig()
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)

  const booking = await prisma.booking.findFirst({
    where: { id, userId: session.userId, status: { not: 'draft' } }, // draf = urusan admin, tak tampil ke jamaah
    include: {
      hotels:     { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } } },
      transports: { include: { transportQuota: { include: { pricing: { include: { trip: true, vehicle: true } } } } } },
      muthowif:   { include: { muthowif: true } },
      catering:   { include: { cateringOption: true } },
      haji:       { include: { hajiProduct: { select: { name: true } } } },
      tourPackages: { include: { tourPackage: true, transportQuota: { include: { pricing: { include: { vehicle: true } } } } } },
      flights:    { include: { flightSchedule: { include: { route: true } } } },
      packages:   { include: { package: { select: { name: true } } } },
      pilgrims:   { orderBy: { id: 'asc' }, select: { ...BOOKING_PILGRIM_SAFE_SELECT, visaApplication: { include: { visaProduct: true } } } }, // kolom tersegel tak pernah dimuat
      payments:   { orderBy: { createdAt: 'desc' }, take: 1 },
      invoice:    { select: { number: true, taxAddedIdr: true, taxIncludedIdr: true, bankSnapshot: true } },
    },
  })
  if (!booking) notFound()
  // Tagihan = subtotal + pajak yang ditambahkan (lib/invoice/bill.ts). Status lunas/sisa tetap mengikuti alur v1 sampai Fase 7.
  const bill = billOf({ totalAmount: booking.totalAmount, invoice: booking.invoice })
  // Harga per item = harga jual beku yang BERLAKU (termasuk harga khusus/revisi), bukan kolom lama baris item.
  const sells = await itemSellTotals(prisma, booking.id)
  const sellOf = (type: string, itemId: string) => sells.get(`${type}:${itemId}`) ?? 0
  // Rekening tujuan = yang DIBEKUKAN di invoice (sama dengan PDF; lib/invoice/banks.ts); setelan env lama hanya cadangan untuk booking tanpa invoice.
  const payTo = booking.invoice
    ? await payableBanks(booking.invoice.bankSnapshot as BankSnapshot[])
    : banks.map(b => ({ bankName: b.bankName, accountNumber: b.accountNumber, accountHolder: b.accountName, branch: null }))
  const hasPendingPayment = (await prisma.payment.count({ where: { bookingId: booking.id, status: 'pending' } })) > 0
  const st = displayStatus({ status: booking.status, confirmedAt: booking.confirmedAt, hasPendingPayment, departureDate: booking.departureDate, returnDate: booking.returnDate })

  // Tabel jamaah (pemilik 2026-11-10): kelengkapan per slot dihitung SATU pemuat yang sama dengan admin (lib/pilgrims/slots.ts); isi/edit per jamaah
  // di halaman bookings/[id]/jamaah/[pilgrimId]. Hanya booking aktif yang bisa diisi/dikosongkan.
  const { slots } = await bookingPilgrimSlots(booking.id, booking.departureDate, booking.pilgrims)
  const open = booking.status === 'active'
  const jamaahHref = (pid: string) => `/${locale}/bookings/${booking.id}/jamaah/${pid}`
  const nextEmpty = slots.find(x => !x.filled)

  const day = (d: Date) => formatCalendarDate(d, DATE_NUMERIC)
  // Satu baris per item; baris identik (mis. visa yang sama untuk tiap jamaah) digabung jadi rumus "3 jamaah × Rp …" (lib/booking/orderSummary.ts).
  const one = (group: string, name: string, detail: string, amount: number, unit = 'pesanan'): SummaryInput => ({ group, name, detail, unit, amount })
  const sections: SummarySection[] = [
    { icon: Package, title: 'Paket Umroh', rows: collapseRows(booking.packages.map(bp => one('Paket Umroh', bp.package.name, `${day(bp.departureDate)} – ${day(bp.returnDate)} · ${bp.numPeople} orang`, sellOf('package', bp.id)))) },
    { icon: Landmark, title: 'Haji', rows: collapseRows(booking.haji.map(bh => one('Haji', bh.hajiProduct.name, `${bh.numPersons} orang`, sellOf('haji', bh.id)))) },
    { icon: Plane, title: 'Tiket Pesawat', rows: collapseRows(booking.flights.map(bf => one('Tiket Pesawat', `${bf.flightSchedule.route.origin} → ${bf.flightSchedule.route.destination}`, `${day(bf.departureDate)} · ${bf.numPassengers} penumpang`, sellOf('flight', bf.id)))) },
    { icon: Building2, title: 'Hotel', rows: collapseRows(booking.hotels.map(h => one('Hotel', h.hotelRoomSchedule.period.hotel.name, `${h.hotelRoomSchedule.period.hotel.city} · ${h.nights} malam · ${h.numRooms} kamar ${h.hotelRoomSchedule.roomType.name}`, sellOf('hotel', h.id)))) },
    { icon: Bus, title: 'Transport', rows: collapseRows(booking.transports.map(bt => one('Transport', bt.transportQuota.pricing.trip.name, `${day(bt.travelDate)} · ${bt.transportQuota.pricing.vehicle.name} · ${bt.numPassengers} penumpang`, sellOf('transport', bt.id)))) },
    { icon: UserRound, title: 'Muthowif', rows: collapseRows(booking.muthowif.map(bm => one('Muthowif', bm.muthowif?.name ?? 'Layanan Muthowif', `${day(bm.startDate)} – ${day(bm.endDate)} · ${bm.numDays} hari · ${bm.numPeople} orang`, sellOf('muthowif', bm.id)))) },
    { icon: UtensilsCrossed, title: 'Katering', rows: collapseRows(booking.catering.map(bc => one('Katering', bc.cateringOption.name, `${day(bc.startDate)} – ${day(bc.endDate)} · ${bc.numDays} hari · ${bc.numPeople} orang`, sellOf('catering', bc.id)))) },
    { icon: Building2, title: 'Paket Ziarah', rows: collapseRows(booking.tourPackages.map(tp => one('Paket Ziarah', tp.tourPackage.name, `${day(tp.tourDate)} · ${tp.numPeople} orang${tp.transportQuota ? ` · ${tp.transportQuota.pricing.vehicle.name}` : ''}`, sellOf('tourPackage', tp.id)))) },
    { icon: Stamp, title: 'Visa', rows: collapseRows(booking.pilgrims.flatMap(p => p.visaApplication ? [one('Visa', p.visaApplication.visaProduct?.name ?? 'Visa', p.visaApplication.selectedDurationDays ? `${p.visaApplication.selectedDurationDays} hari` : '', sellOf('visa', p.visaApplication.id), 'jamaah')] : [])) },
  ]
  // Diskon/biaya tambahan di total pesanan tidak menempel pada satu layanan: tampil terpisah supaya rincian di atas tetap menjumlah ke tagihan.
  const shownCents = sections.reduce((sum, c) => sum + c.rows.reduce((n, r) => n + Math.round(r.amount * 100), 0), 0)
  const adjustment = (Math.round(bill.subtotal * 100) - shownCents) / 100
  const proofRejected = booking.payments[0]?.status === 'rejected'

  const statusCfg = BOOKING_STATUS[st]
  const deadline = booking.paymentDeadline

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <Link href={`/${locale}/dashboard`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke Dashboard
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm text-muted-foreground">Kode Booking</p>
            <h1 className="text-3xl font-bold font-mono tracking-wider text-primary">{booking.bookingCode}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusCfg.badge as 'warning' | 'secondary' | 'success' | 'default' | 'destructive' | 'muted'}>
              {statusCfg.label}
            </Badge>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/v1/bookings/${booking.id}/invoice`} target="_blank" rel="noopener noreferrer">
                <FileDown className="mr-1.5 h-3.5 w-3.5" /> Unduh Invoice
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Baru dipesan dari checkout: langkah berikutnya yang MASIH relevan, tertaut ke bagiannya. */}
      {justBooked && booking.status === 'active' && (
        <div className="rounded-2xl border border-brand/30 bg-brand-light p-5 space-y-3" role="status">
          <p className="flex items-center gap-2 font-bold text-brand-dark"><CheckCircle className="h-5 w-5 text-brand" aria-hidden /> Pesanan diterbitkan</p>
          <p className="text-sm text-brand-dark">Invoice bisa diunduh lewat tombol &ldquo;Unduh Invoice&rdquo;.{st === 'awaiting_payment' ? ' Selesaikan dua langkah berikut:' : ' Langkah berikutnya:'}</p>
          <ol className={`grid gap-2 text-sm ${st === 'awaiting_payment' ? 'sm:grid-cols-2' : ''}`}>
            <li><a href="#data-jamaah" className="flex h-full items-start gap-2 rounded-xl bg-white/80 p-3 font-medium text-brand-dark hover:bg-white"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">1</span> Isi data & dokumen jamaah — pilih dari Jamaah Saya, tambah baru, atau jadikan Anda sendiri jamaah.</a></li>
            {st === 'awaiting_payment' && <li><a href="#pembayaran" className="flex h-full items-start gap-2 rounded-xl bg-white/80 p-3 font-medium text-brand-dark hover:bg-white"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">2</span> Transfer sesuai tagihan, lalu unggah bukti transfer.</a></li>}
          </ol>
        </div>
      )}

      {/* Payment notice */}
      {(st === 'awaiting_payment' || st === 'payment_review') && (
        <div id="pembayaran" className="scroll-mt-24 rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            <p className="font-semibold text-amber-800">Selesaikan Pembayaran</p>
          </div>
          {deadline && (
            <p className="text-sm text-amber-700">
              Mohon bayar sebelum: <span className="font-bold">{formatInstant(deadline, DATETIME_FULL)}</span>
            </p>
          )}
          <div className="rounded-lg bg-white/70 p-4 space-y-2 text-sm">
            <p className="font-semibold">Transfer ke rekening:</p>
            {payTo.length === 0 && <p className="text-amber-800">Nomor rekening belum tersedia. Mohon hubungi tim Saudinesia sebelum melakukan transfer.</p>}
            <div className="grid grid-cols-2 gap-1">
              {payTo.map((b) => (
                <React.Fragment key={`${b.bankName}-${b.accountNumber}`}>
                  <span className="text-muted-foreground">{b.bankName}</span>
                  <span className="font-mono font-bold">{b.accountNumber} <span className="font-sans font-normal text-muted-foreground">a.n. {b.accountHolder}</span></span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-amber-900">{formatRupiah(bill.grandTotal)}</p>
          </div>
          {st === 'awaiting_payment' && proofRejected && (
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /> Bukti transfer sebelumnya ditolak. Periksa kembali lalu unggah bukti yang benar.
            </p>
          )}
          {st === 'awaiting_payment' && <PaymentProofUpload bookingId={booking.id} />}
          {st === 'payment_review' && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="h-4 w-4" /> Bukti transfer sudah diupload, menunggu konfirmasi.
            </div>
          )}
        </div>
      )}

      {/* Trip summary */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Detail Perjalanan</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Berangkat</p><p className="font-semibold">{booking.departureDate ? formatCalendarDate(booking.departureDate, DATE_LONG) : '-'}</p></div>
          <div><p className="text-muted-foreground">Kembali</p><p className="font-semibold">{booking.returnDate ? formatCalendarDate(booking.returnDate, DATE_LONG) : '-'}</p></div>
          <div><p className="text-muted-foreground">Jumlah Jamaah</p><p className="font-semibold">{booking.pilgrims.length} orang</p></div>
          <div><p className="text-muted-foreground">Musim</p><p className="font-semibold capitalize">{booking.season}</p></div>
        </div>
      </div>

      {/* Rincian: semua yang ditagih tampil di sini (dijaga scripts/test-payment-path.ts) */}
      <OrderSummaryCard sections={sections} adjustment={adjustment} taxAdded={bill.taxAdded} grandTotal={bill.grandTotal} invoiceNumber={booking.invoice?.number ?? null} />

      {/* Pilgrims + document upload per jamaah */}
      <div id="data-jamaah" className="scroll-mt-24 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <UserRound className="h-4 w-4 text-primary" /> Data & Dokumen Jamaah
        </h3>
        <p className="text-sm text-muted-foreground">Isi satu per satu: data diri dan dokumen tiap jamaah, lalu ajukan untuk diperiksa petugas.</p>
        <PilgrimSlotsTable
          total={slots.length}
          slots={slots.map(x => ({ ...x, editHref: jamaahHref(x.id) }))}
          addHref={open && nextEmpty ? jamaahHref(nextEmpty.id) : null}
          deleteEndpoint={open ? `/api/v1/bookings/${booking.id}/pilgrims/{id}` : null}
        />
      </div>

    </div>
  )
}
