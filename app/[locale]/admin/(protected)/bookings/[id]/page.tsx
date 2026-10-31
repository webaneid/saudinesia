import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { formatRupiah } from '@/lib/utils'
import { displayStatus } from '@/lib/booking/lifecycle'
import { BOOKING_STATUS, VISA_STATUS, VISA_TYPE_LABEL, REQUIRED_DOCUMENTS } from '@/lib/constants/booking'
import { getPaymentConfig } from '@/lib/constants/payment'
import { ArrowLeft, FileDown } from 'lucide-react'
import { PaymentActions } from './PaymentActions'
import { InvoiceBox } from './InvoiceBox'
import { billOf } from '@/lib/invoice/bill'
import type { TaxLine } from '@/lib/invoice/tax'
import { VisaActions } from './VisaActions'
import { PilgrimDataForm } from './PilgrimDataForm'
import { MuthowifAssignPanel } from './MuthowifAssignPanel'
import { PilgrimDocuments } from '@/components/admin/PilgrimDocuments'
import { getDocumentRequirements } from '@/lib/documents/getRequirements'
import { getManifestFieldRequirements, getFieldByRole } from '@/lib/manifest/getRequirements'
import { CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID } from '@/lib/manifest/constants'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { canRecordCost } from '@/lib/pricing/policy'
import { BookingPriceCard } from './BookingPriceCard'
import { CostActualsPanel } from './CostActualsPanel'
import { DATE_LONG, DATE_NUMERIC, calendarDateOf, formatCalendarDate, formatInstant } from '@/lib/time'

type Props = { params: Promise<{ locale: string; id: string }> }

export default async function AdminBookingDetail({ params }: Props) {
  const { locale, id } = await params
  const session = await requireAdminPage(locale)
  const { banks, businessName } = getPaymentConfig()

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      user:       { select: { fullName: true, email: true, phone: true } },
      hotels:     { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } } } } } },
      transports: { include: { transportQuota: { include: { pricing: { include: { trip: true, vehicle: true } } } } } },
      muthowif:   { include: { muthowif: true } },
      catering:   { include: { cateringOption: true } },
      tourPackages: { include: { tourPackage: true, transportQuota: { include: { pricing: { include: { vehicle: true } } } } } },
      flights:    { include: { flightSchedule: { include: { route: true } } } },
      packages:   { include: { package: { select: { name: true } } } },
      pilgrims:   { include: { visaApplication: { include: { visaProduct: true } }, documents: true } },
      payments:   { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
      invoice:    true,
    },
  })
  if (!booking) notFound()
  if (booking.status === 'draft') redirect(`/${locale}/admin/bookings/drafts/${id}`) // draf diedit di editor draf (§10.3)

  // docs/arsitektur-dokumen.md §4 — getDocumentRequirements() menggantikan
  // parseRequirements(visaProduct.requirements), dikumpulkan per pilgrim (server component, jadi
  // dihitung sekali sebelum render, bukan dipanggil sinkron di dalam .map()).
  const requirementsByPilgrim = new Map<string, Awaited<ReturnType<typeof getDocumentRequirements>>>()
  // docs/arsitektur-manifest.md §4 — getManifestFieldRequirements()/getFieldByRole() menggantikan
  // pembacaan langsung p.fullName dkk (kolom baku sudah dihapus, sekarang fieldValues generik).
  const manifestFieldsByPilgrim = new Map<string, Awaited<ReturnType<typeof getManifestFieldRequirements>>>()
  for (const p of booking.pilgrims) {
    if (p.visaApplication?.visaProductId) {
      requirementsByPilgrim.set(p.id, await getDocumentRequirements('visa', p.visaApplication.visaProductId))
      manifestFieldsByPilgrim.set(p.id, await getManifestFieldRequirements('visa', p.visaApplication.visaProductId))
    } else {
      // docs/arsitektur-booking.md §6 Step 6a — pilgrim tanpa visa (mis. checkout Transport-only)
      // tetap punya field manifest generik untuk menampilkan nama dkk. — bukan 'Jamaah' fallback.
      manifestFieldsByPilgrim.set(p.id, await getManifestFieldRequirements(CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID))
      // [] eksplisit (BUKAN dibiarkan undefined) — PilgrimDocuments jatuh ke REQUIRED_DOCUMENTS
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

  const st      = displayStatus({ status: booking.status, confirmedAt: booking.confirmedAt, hasPendingPayment: booking.payments.some(p => p.status === 'pending'), departureDate: booking.departureDate, returnDate: booking.returnDate })
  const cfg     = BOOKING_STATUS[st]
  const payment = booking.payments[0]
  const bill    = billOf(booking)

  const STATUS_BADGE: Record<string, string> = {
    payment_review:   'admin-badge-blue',
    awaiting_payment: 'admin-badge-amber',
    confirmed:        'admin-badge-green',
    in_progress:      'admin-badge-blue',
    completed:        'admin-badge-green',
    cancelled:        'admin-badge-red',
    expired:          'admin-badge-red',
  }

  const VISA_BADGE: Record<string, string> = {
    issued:            'admin-badge-green',
    pending_documents: 'admin-badge-red',
    rejected:          'admin-badge-red',
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/${locale}/admin/bookings`}
          className="h-9 w-9 rounded-xl border border-admin-line grid place-items-center text-admin-muted hover:text-admin-ink hover:bg-white hover:shadow-admin transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-mono text-xl font-bold text-admin-accent-strong">{booking.bookingCode}</h1>
          <p className="text-[12px] text-admin-muted mt-0.5">
            {booking.user.fullName} · {booking.user.phone}
          </p>
        </div>
        <a href={`/api/v1/bookings/${booking.id}/invoice`} target="_blank" rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-admin-line px-3 py-1.5 text-[12px] font-medium text-admin-ink/80 hover:text-admin-ink hover:bg-white hover:shadow-admin transition-colors">
          <FileDown className="h-3.5 w-3.5" /> Unduh Invoice
        </a>
        <span className={STATUS_BADGE[st] ?? 'admin-badge-gray'}>
          {cfg.label}
        </span>
      </div>

      {/* Payment confirmation */}
      {(st === 'payment_review' || st === 'awaiting_payment') && payment && (
        <PaymentActions bookingId={id} paymentId={payment.id} buktiPath={payment.buktiTransferPath} billTotal={bill.grandTotal} />
      )}

      {/* Services summary */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="admin-card p-4 space-y-2">
          <p className="admin-section">Perjalanan</p>
          <p className="text-[13px] text-admin-ink/80">
            Berangkat:{' '}
            <span className="font-medium text-admin-ink">
              {booking.departureDate ? formatCalendarDate(booking.departureDate, DATE_LONG) : 'Belum ada tanggal'}
            </span>
          </p>
          <p className="text-[13px] text-admin-ink/80">
            Kembali:{' '}
            <span className="font-medium text-admin-ink">
              {booking.returnDate ? formatCalendarDate(booking.returnDate, DATE_LONG) : 'Belum ada tanggal'}
            </span>
          </p>
          <p className="text-[13px] text-admin-ink/80">
            Musim: <span className="font-medium text-admin-ink capitalize">{booking.season}</span>
          </p>
        </div>

        <InvoiceBox bookingId={booking.id} bill={bill} invoice={booking.invoice && { ...booking.invoice, taxLines: booking.invoice.taxLines as TaxLine[] }} />

        {booking.hotels.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Hotel</p>
            {booking.hotels.map(h => (
              <p key={h.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{h.hotelRoomSchedule.period.hotel.name}</span>
                {' — '}
                <span className="capitalize">{h.hotelRoomSchedule.period.hotel.city}</span>
                <span className="text-admin-muted ml-2 text-[12px]">{h.nights} mlm</span>
              </p>
            ))}
          </div>
        )}

        {booking.packages.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Paket Umroh</p>
            {booking.packages.map(bp => (
              <p key={bp.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{bp.package.name}</span>
                {' — '}
                <span>{formatCalendarDate(bp.departureDate, DATE_NUMERIC)} – {formatCalendarDate(bp.returnDate, DATE_NUMERIC)}</span>
                <span className="text-admin-muted ml-2 text-[12px]">{bp.numPeople} orang · {formatRupiah(Number(bp.totalPrice))}</span>
              </p>
            ))}
          </div>
        )}

        {booking.flights.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Tiket Pesawat</p>
            {booking.flights.map(bf => (
              <p key={bf.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{bf.flightSchedule.route.origin} → {bf.flightSchedule.route.destination}</span>
                {' — '}
                <span>{formatCalendarDate(bf.departureDate, DATE_NUMERIC)}</span>
                <span className="text-admin-muted ml-2 text-[12px]">{bf.numPassengers} penumpang · {formatRupiah(Number(bf.totalPrice))}</span>
              </p>
            ))}
          </div>
        )}

        {booking.tourPackages.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Paket Ziarah</p>
            {booking.tourPackages.map(tp => (
              <p key={tp.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{tp.tourPackage.name}</span>
                {' — '}
                <span>{formatCalendarDate(tp.tourDate, DATE_NUMERIC)}</span>
                <span className="text-admin-muted ml-2 text-[12px]">
                  {tp.numPeople} orang{tp.transportQuota ? ` · ${tp.transportQuota.pricing.vehicle.name}` : ''} · {formatRupiah(Number(tp.totalPrice))}
                </span>
              </p>
            ))}
          </div>
        )}

        {booking.muthowif.length > 0 && (
          <div className="admin-card p-4 space-y-3">
            <p className="admin-section">Muthowif</p>
            {booking.muthowif.map(bm => (
              <div key={bm.id} className="space-y-2">
                <p className="text-[13px] text-admin-ink/80">
                  {formatCalendarDate(bm.startDate, DATE_NUMERIC)} – {formatCalendarDate(bm.endDate, DATE_NUMERIC)}
                  <span className="text-admin-muted ml-2 text-[12px]">{bm.numDays} hari × {bm.numPeople} orang</span>
                </p>
                {bm.muthowif ? (
                  <p className="text-[13px] text-admin-ink">
                    <span className="font-medium">{bm.muthowif.name}</span>
                    <span className="text-admin-muted ml-2 text-[12px]">
                      di-assign {bm.assignedAt ? formatInstant(bm.assignedAt, DATE_NUMERIC) : '-'}
                    </span>
                  </p>
                ) : (
                  <MuthowifAssignPanel bookingId={id} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Harga: tiga total + atur total (semua admin) + pengeluaran aktual vendor (manager+; daftar vendor hanya terbuka untuk manager+) */}
      <BookingPriceCard bookingId={id} status={st} />
      {canRecordCost(session.role) && <CostActualsPanel bookingId={id} />}

      {/* Dokumen per jamaah */}
      {booking.pilgrims.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[14px] font-bold text-admin-ink">Dokumen Jamaah</h2>
          {booking.pilgrims.map(p => (
            <PilgrimDocuments
              key={p.id}
              bookingId={id}
              pilgrimId={p.id}
              pilgrimName={displayName(p)}
              bookingCode={booking.bookingCode}
              requirements={requirementsByPilgrim.get(p.id)}
            />
          ))}
        </div>
      )}

      {/* Pilgrim list */}
      <div className="admin-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-admin-line">
          <span className="text-[14px] font-bold text-admin-ink">
            Jamaah ({booking.pilgrims.length} orang)
          </span>
        </div>
        <div className="divide-y divide-admin-line">
          {booking.pilgrims.map((p) => {
            const visaCfg = VISA_STATUS[p.visaApplication?.status as keyof typeof VISA_STATUS]
            const pilgrimRequirements = requirementsByPilgrim.get(p.id) ?? null
            const requiredDocCount = pilgrimRequirements
              ? pilgrimRequirements.filter(r => r.required).length
              : REQUIRED_DOCUMENTS.length
            return (
              <div key={p.id} className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-admin-ink text-[14px]">{displayName(p)}</p>
                    <p className="text-[11px] text-admin-muted mt-0.5">
                      {VISA_TYPE_LABEL[p.visaApplication?.visaType ?? ''] ?? '-'}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <span className={VISA_BADGE[p.visaApplication?.status ?? ''] ?? 'admin-badge-gray'}>
                      {visaCfg?.label}
                    </span>
                    <p className="text-[10.5px] text-admin-muted">
                      {p.documents.length}/{requiredDocCount} dok
                    </p>
                  </div>
                </div>

                <PilgrimDataForm
                  bookingId={id}
                  pilgrimId={p.id}
                  fields={(manifestFieldsByPilgrim.get(p.id) ?? []).map(f => ({ id: f.id, fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType, options: f.options, required: f.required, role: f.role, order: f.order }))}
                  initial={p.fieldValues as Record<string, unknown>}
                  plannedTravelDate={p.visaApplication ? (p.visaApplication.plannedTravelDate ? calendarDateOf(p.visaApplication.plannedTravelDate) : null) : undefined}
                />

                {p.visaApplication && (
                  <VisaActions
                    pilgrimId={p.id}
                    visaAppId={p.visaApplication.id}
                    currentStatus={p.visaApplication.status}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
