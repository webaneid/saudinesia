import React from 'react'
import { safeLocale } from '@/lib/utils/locale'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { formatRupiah } from '@/lib/utils'
import { billOf } from '@/lib/invoice/bill'
import { CheckCircle, Clock, UserRound, UploadCloud, ArrowLeft, Building2, FileDown, Package, Plane } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { displayStatus } from '@/lib/booking/lifecycle'
import { BOOKING_STATUS, VISA_STATUS, REQUIRED_DOCUMENTS } from '@/lib/constants/booking'
import { getPaymentConfig } from '@/lib/constants/payment'
import { DocumentGrid } from '@/components/shared/media/DocumentGrid'
import { getDocumentRequirements } from '@/lib/documents/getRequirements'
import { getManifestFieldRequirements, getFieldByRole } from '@/lib/manifest/getRequirements'
import { CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID } from '@/lib/manifest/constants'
import { DATETIME_FULL, DATE_LONG, DATE_NUMERIC, formatCalendarDate, formatInstant } from '@/lib/time'

type Props = { params: Promise<{ locale: string; id: string }> }

export default async function BookingDetailPage({ params }: Props) {
  const { locale, id } = await params
  const { banks, businessName } = getPaymentConfig()
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)

  const booking = await prisma.booking.findFirst({
    where: { id, userId: session.userId, status: { not: 'draft' } }, // draf = urusan admin, tak tampil ke jamaah
    include: {
      hotels:     { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } } },
      transports: { include: { transportQuota: { include: { pricing: { include: { trip: true, vehicle: true } } } } } },
      muthowif:   { include: { muthowif: true } },
      catering:   { include: { cateringOption: true } },
      tourPackages: { include: { tourPackage: true, transportQuota: { include: { pricing: { include: { vehicle: true } } } } } },
      flights:    { include: { flightSchedule: { include: { route: true } } } },
      packages:   { include: { package: { select: { name: true } } } },
      pilgrims:   { include: { visaApplication: { include: { visaProduct: true } }, documents: true } },
      payments:   { orderBy: { createdAt: 'desc' }, take: 1 },
      invoice:    { select: { number: true, taxAddedIdr: true, taxIncludedIdr: true } },
    },
  })
  if (!booking) notFound()
  // Tagihan = subtotal + pajak yang ditambahkan (lib/invoice/bill.ts). Status lunas/sisa tetap mengikuti alur v1 sampai Fase 7.
  const bill = billOf({ totalAmount: booking.totalAmount, invoice: booking.invoice })
  const hasPendingPayment = (await prisma.payment.count({ where: { bookingId: booking.id, status: 'pending' } })) > 0
  const st = displayStatus({ status: booking.status, confirmedAt: booking.confirmedAt, hasPendingPayment, departureDate: booking.departureDate, returnDate: booking.returnDate })

  // docs/arsitektur-dokumen.md §4 — getDocumentRequirements() menggantikan
  // parseRequirements(visaProduct.requirements)
  const requirementsByPilgrim = new Map<string, Awaited<ReturnType<typeof getDocumentRequirements>>>()
  const manifestFieldsByPilgrim = new Map<string, Awaited<ReturnType<typeof getManifestFieldRequirements>>>()
  for (const p of booking.pilgrims) {
    if (p.visaApplication?.visaProductId) {
      requirementsByPilgrim.set(p.id, await getDocumentRequirements('visa', p.visaApplication.visaProductId))
      manifestFieldsByPilgrim.set(p.id, await getManifestFieldRequirements('visa', p.visaApplication.visaProductId))
    } else {
      // docs/arsitektur-booking.md §6 Step 6a — pilgrim tanpa visa (mis. checkout Transport-only)
      // tetap punya field manifest generik untuk menampilkan nama dkk. — bukan 'Jamaah' fallback.
      manifestFieldsByPilgrim.set(p.id, await getManifestFieldRequirements(CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID))
      // [] eksplisit (BUKAN dibiarkan undefined) — DocumentGrid jatuh ke REQUIRED_DOCUMENTS
      // (daftar hardcode paspor/KTP/dst.) kalau requirements undefined, yang salah untuk pilgrim
      // tanpa visa sama sekali (mis. Transport-only) — tidak ada dokumen yang wajib diupload.
      requirementsByPilgrim.set(p.id, [])
    }
  }
  function displayName(p: NonNullable<typeof booking>['pilgrims'][number]): string {
    const fields = manifestFieldsByPilgrim.get(p.id) ?? []
    const name = getFieldByRole(fields, p.fieldValues as Record<string, unknown>, 'display_name')
    return typeof name === 'string' && name ? name : 'Jamaah'
  }

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
            <div className="grid grid-cols-2 gap-1">
              {banks.map((b) => (
                <React.Fragment key={b.bankName}>
                  <span className="text-muted-foreground">Bank {b.bankName}</span>
                  <span className="font-mono font-bold">{b.accountNumber}</span>
                </React.Fragment>
              ))}
              <span className="text-muted-foreground">A.n.</span>
              <span className="font-bold">{businessName}</span>
            </div>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-amber-900">{formatRupiah(bill.grandTotal)}</p>
          </div>
          {st === 'awaiting_payment' && (
            <Button asChild className="w-full">
              <Link href={`/${locale}/bookings/${id}/upload-bukti`}>
                <UploadCloud className="mr-2 h-4 w-4" /> Upload Bukti Transfer
              </Link>
            </Button>
          )}
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

      {/* Services */}
      {booking.hotels.length > 0 && (
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Hotel</h3>
          {booking.hotels.map(h => (
            <div key={h.id} className="flex justify-between text-sm">
              <div>
                <p className="font-medium">{h.hotelRoomSchedule.period.hotel.name}</p>
                <p className="text-muted-foreground capitalize">{h.hotelRoomSchedule.period.hotel.city} · {h.nights} malam · {h.numRooms} kamar {h.hotelRoomSchedule.roomType.name}</p>
              </div>
              <p className="font-semibold">{formatRupiah(Number(h.totalPrice))}</p>
            </div>
          ))}
        </div>
      )}

      {booking.packages.length > 0 && (
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Package className="h-4 w-4 text-primary" /> Paket Umroh</h3>
          {booking.packages.map(bp => (
            <div key={bp.id} className="flex justify-between text-sm">
              <div>
                <p className="font-medium">{bp.package.name}</p>
                <p className="text-muted-foreground">{formatCalendarDate(bp.departureDate, DATE_NUMERIC)} – {formatCalendarDate(bp.returnDate, DATE_NUMERIC)} · {bp.numPeople} orang</p>
              </div>
              <p className="font-semibold">{formatRupiah(Number(bp.totalPrice))}</p>
            </div>
          ))}
        </div>
      )}

      {booking.flights.length > 0 && (
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Plane className="h-4 w-4 text-primary" /> Tiket Pesawat</h3>
          {booking.flights.map(bf => (
            <div key={bf.id} className="flex justify-between text-sm">
              <div>
                <p className="font-medium">{bf.flightSchedule.route.origin} → {bf.flightSchedule.route.destination}</p>
                <p className="text-muted-foreground">{formatCalendarDate(bf.departureDate, DATE_NUMERIC)} · {bf.numPassengers} penumpang</p>
              </div>
              <p className="font-semibold">{formatRupiah(Number(bf.totalPrice))}</p>
            </div>
          ))}
        </div>
      )}

      {booking.tourPackages.length > 0 && (
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Paket Ziarah</h3>
          {booking.tourPackages.map(tp => (
            <div key={tp.id} className="flex justify-between text-sm">
              <div>
                <p className="font-medium">{tp.tourPackage.name}</p>
                <p className="text-muted-foreground">{formatCalendarDate(tp.tourDate, DATE_NUMERIC)} · {tp.numPeople} orang{tp.transportQuota ? ` · ${tp.transportQuota.pricing.vehicle.name}` : ''}</p>
              </div>
              <p className="font-semibold">{formatRupiah(Number(tp.totalPrice))}</p>
            </div>
          ))}
        </div>
      )}

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
            <DocumentGrid
              bookingId={booking.id}
              pilgrimId={p.id}
              pilgrimName={displayName(p)}
              requirements={requirementsByPilgrim.get(p.id)}
            />
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="rounded-xl border bg-card p-5 flex justify-between items-center">
        <div>
          <p className="font-semibold">Total Tagihan</p>
          {booking.invoice && <p className="text-xs text-muted-foreground">Invoice {booking.invoice.number}{bill.taxAdded > 0 ? ` · termasuk pajak ${formatRupiah(bill.taxAdded)}` : ''}</p>}
        </div>
        <p className="text-2xl font-bold text-primary">{formatRupiah(bill.grandTotal)}</p>
      </div>
    </div>
  )
}
