import React from 'react'
import { BookingServiceCard, type ServiceRow } from './BookingServiceCard'
import { PaymentProofUpload } from './PaymentProofUpload'
import { safeLocale } from '@/lib/utils/locale'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
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
import { BOOKING_STATUS, VISA_STATUS } from '@/lib/constants/booking'
import { getPaymentConfig } from '@/lib/constants/payment'
import { BOOKING_PILGRIM_SAFE_SELECT, bookingChecklists } from '@/lib/pilgrims/bookingLink'
import { PilgrimTripPanel } from './PilgrimTripPanel'
import { reviewHistoryOf } from '@/lib/pilgrims/review'
import { getManifestFieldRequirements, getFieldByRole } from '@/lib/manifest/getRequirements'
import { CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID } from '@/lib/manifest/constants'
import { DATETIME_FULL, DATE_LONG, DATE_NUMERIC, calendarDateOf, formatCalendarDate, formatInstant } from '@/lib/time'

type Props = { params: Promise<{ locale: string; id: string }> }

export default async function BookingDetailPage({ params }: Props) {
  const { locale, id } = await params
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
      pilgrims:   { select: { ...BOOKING_PILGRIM_SAFE_SELECT, visaApplication: { include: { visaProduct: true } } } }, // kolom tersegel tak pernah dimuat
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

  // Kartu tertaut + kelengkapan dokumen per jamaah — aturan yang sama dengan halaman admin (lib/pilgrims/bookingLink.ts → evaluateCompleteness).
  const checklists = await bookingChecklists(booking.id, booking.departureDate ? calendarDateOf(booking.departureDate) : null, booking.pilgrims.map(p => ({
    id: p.id, savedPilgrimId: p.savedPilgrimId,
    plannedTravelDate: p.visaApplication?.plannedTravelDate ? calendarDateOf(p.visaApplication.plannedTravelDate) : null,
  })))
  // Catatan perbaikan terakhir dari petugas (Fase 6) — nama petugas tidak dikirim ke pemesan.
  const reviewHistory = await reviewHistoryOf(booking.pilgrims.map(p => p.id), false)
  const manifestFieldsByPilgrim = new Map<string, Awaited<ReturnType<typeof getManifestFieldRequirements>>>()
  for (const p of booking.pilgrims) {
    if (p.visaApplication?.visaProductId) {
      manifestFieldsByPilgrim.set(p.id, await getManifestFieldRequirements('visa', p.visaApplication.visaProductId))
    } else {
      // docs/arsitektur-booking.md §6 Step 6a — pilgrim tanpa visa (mis. checkout Transport-only)
      // tetap punya field manifest generik untuk menampilkan nama dkk. — bukan 'Jamaah' fallback.
      manifestFieldsByPilgrim.set(p.id, await getManifestFieldRequirements(CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID))
    }
  }
  function displayName(p: NonNullable<typeof booking>['pilgrims'][number]): string {
    const fields = manifestFieldsByPilgrim.get(p.id) ?? []
    const name = getFieldByRole(fields, p.fieldValues as Record<string, unknown>, 'display_name')
    return typeof name === 'string' && name ? name : 'Jamaah'
  }

  const day = (d: Date) => formatCalendarDate(d, DATE_NUMERIC)
  const serviceCards: { icon: LucideIcon; title: string; rows: ServiceRow[] }[] = [
    { icon: Package, title: 'Paket Umroh', rows: booking.packages.map(bp => ({ id: bp.id, name: bp.package.name, detail: `${day(bp.departureDate)} – ${day(bp.returnDate)} · ${bp.numPeople} orang`, price: sellOf('package', bp.id) })) },
    { icon: Landmark, title: 'Haji', rows: booking.haji.map(bh => ({ id: bh.id, name: bh.hajiProduct.name, detail: `${bh.numPersons} orang`, price: sellOf('haji', bh.id) })) },
    { icon: Plane, title: 'Tiket Pesawat', rows: booking.flights.map(bf => ({ id: bf.id, name: `${bf.flightSchedule.route.origin} → ${bf.flightSchedule.route.destination}`, detail: `${day(bf.departureDate)} · ${bf.numPassengers} penumpang`, price: sellOf('flight', bf.id) })) },
    { icon: Building2, title: 'Hotel', rows: booking.hotels.map(h => ({ id: h.id, name: h.hotelRoomSchedule.period.hotel.name, detail: `${h.hotelRoomSchedule.period.hotel.city} · ${h.nights} malam · ${h.numRooms} kamar ${h.hotelRoomSchedule.roomType.name}`, price: sellOf('hotel', h.id) })) },
    { icon: Bus, title: 'Transport', rows: booking.transports.map(bt => ({ id: bt.id, name: bt.transportQuota.pricing.trip.name, detail: `${day(bt.travelDate)} · ${bt.transportQuota.pricing.vehicle.name} · ${bt.numPassengers} penumpang`, price: sellOf('transport', bt.id) })) },
    { icon: UserRound, title: 'Muthowif', rows: booking.muthowif.map(bm => ({ id: bm.id, name: bm.muthowif?.name ?? 'Layanan Muthowif', detail: `${day(bm.startDate)} – ${day(bm.endDate)} · ${bm.numDays} hari · ${bm.numPeople} orang`, price: sellOf('muthowif', bm.id) })) },
    { icon: UtensilsCrossed, title: 'Katering', rows: booking.catering.map(bc => ({ id: bc.id, name: bc.cateringOption.name, detail: `${day(bc.startDate)} – ${day(bc.endDate)} · ${bc.numDays} hari · ${bc.numPeople} orang`, price: sellOf('catering', bc.id) })) },
    { icon: Building2, title: 'Paket Ziarah', rows: booking.tourPackages.map(tp => ({ id: tp.id, name: tp.tourPackage.name, detail: `${day(tp.tourDate)} · ${tp.numPeople} orang${tp.transportQuota ? ` · ${tp.transportQuota.pricing.vehicle.name}` : ''}`, price: sellOf('tourPackage', tp.id) })) },
    { icon: Stamp, title: 'Visa', rows: booking.pilgrims.flatMap(p => p.visaApplication ? [{ id: p.visaApplication.id, name: p.visaApplication.visaProduct?.name ?? 'Visa', detail: displayName(p), price: sellOf('visa', p.visaApplication.id) }] : []) },
  ]
  // Diskon/biaya tambahan di total pesanan tidak menempel pada satu layanan: tampil terpisah supaya rincian di atas tetap menjumlah ke tagihan.
  const shownCents = serviceCards.reduce((sum, c) => sum + c.rows.reduce((n, r) => n + Math.round(r.price * 100), 0), 0)
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

      {/* Payment notice */}
      {(st === 'awaiting_payment' || st === 'payment_review') && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4">
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

      {/* Services: semua yang ditagih tampil di sini (dijaga scripts/test-payment-path.ts) */}
      {serviceCards.map(c => <BookingServiceCard key={c.title} icon={c.icon} title={c.title} rows={c.rows} />)}

      {/* Pilgrims + document upload per jamaah */}
      <div className="space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <UserRound className="h-4 w-4 text-primary" /> Data & Dokumen Jamaah
        </h3>
        {booking.pilgrims.map((p) => (
          <div key={p.id} className="rounded-xl border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between text-sm">
              <div>
                <p className="font-medium">{displayName(p)}</p>
                <p className="text-muted-foreground capitalize">{p.visaApplication?.visaType ?? ''}</p>
              </div>
              <Badge variant={
                (VISA_STATUS[p.visaApplication?.status as keyof typeof VISA_STATUS]?.badge ?? 'secondary') as
                'success' | 'warning' | 'secondary' | 'destructive' | 'muted'
              }>
                {VISA_STATUS[p.visaApplication?.status as keyof typeof VISA_STATUS]?.label ?? p.visaApplication?.status}
              </Badge>
            </div>
            {/* Data & dokumen dari Jamaah Saya + dokumen per perjalanan (docs/arsitektur-jamaah.md §5.5). */}
            <PilgrimTripPanel
              locale={safeLocale(locale)} bookingId={booking.id} pilgrimId={p.id}
              linked={checklists.get(p.id)?.card ?? null}
              checklist={(checklists.get(p.id)?.items ?? []).map(i => ({ key: i.key, label: i.label, required: i.required, state: i.state, sources: i.sources ?? [] }))}
              review={{
                status: p.reviewStatus,
                open: booking.status === 'active',
                ready: checklists.get(p.id)?.ready ?? false,
                note: p.reviewStatus === 'needs_revision' ? (reviewHistory.get(p.id)?.find(h => h.to === 'needs_revision')?.note ?? null) : null,
              }}
            />
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        {adjustment !== 0 && (
          <div className="flex justify-between text-sm">
            <p className="text-muted-foreground">Penyesuaian harga</p>
            <p className="font-semibold">{adjustment < 0 ? `-${formatRupiah(-adjustment)}` : formatRupiah(adjustment)}</p>
          </div>
        )}
        <div className="flex justify-between items-center">
        <div>
          <p className="font-semibold">Total Tagihan</p>
          {booking.invoice && <p className="text-xs text-muted-foreground">Invoice {booking.invoice.number}{bill.taxAdded > 0 ? ` · termasuk pajak ${formatRupiah(bill.taxAdded)}` : ''}</p>}
        </div>
        <p className="text-2xl font-bold text-primary">{formatRupiah(bill.grandTotal)}</p>
        </div>
      </div>
    </div>
  )
}
