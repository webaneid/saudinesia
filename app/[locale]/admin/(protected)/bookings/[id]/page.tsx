import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { displayStatus } from '@/lib/booking/lifecycle'
import { BOOKING_STATUS, VISA_STATUS, VISA_TYPE_LABEL } from '@/lib/constants/booking'
import { ArrowLeft, FileDown, Pencil, UserCog } from 'lucide-react'
import { PaymentActions } from './PaymentActions'
import { InvoiceBox } from './InvoiceBox'
import { RevisionHistory } from './RevisionHistory'
import { billOf } from '@/lib/invoice/bill'
import { payableBanks } from '@/lib/invoice/banks'
import type { BankSnapshot } from '@/lib/invoice/issue'
import type { TaxLine } from '@/lib/invoice/tax'
import { VisaActions } from './VisaActions'
import { MuthowifAssignPanel } from './MuthowifAssignPanel'
import { PilgrimReviewPanel } from './PilgrimReviewPanel'
import { reviewHistoryOf } from '@/lib/pilgrims/review'
import { BOOKING_PILGRIM_SAFE_SELECT } from '@/lib/pilgrims/bookingLink'
import { bookingPilgrimSlots } from '@/lib/pilgrims/slots'
import { PilgrimSlotsTable } from '@/components/shared/pilgrims/PilgrimSlotsTable'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { canRecordCost } from '@/lib/pricing/policy'
import { BookingPriceCard } from './BookingPriceCard'
import { CostActualsPanel } from './CostActualsPanel'
import { DATE_LONG, DATE_NUMERIC, formatCalendarDate, formatInstant } from '@/lib/time'
import { itemSellTotals } from '@/lib/pricing/engine/snapshot'
import { collapseRows, formulaOf } from '@/lib/booking/orderSummary'
import { formatRupiah } from '@/lib/utils'
import { groupView } from '@/lib/booking/groups'

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ periksa?: string }> }

export default async function AdminBookingDetail({ params, searchParams }: Props) {
  const { locale, id } = await params
  const { periksa } = await searchParams
  const session = await requireAdminPage(locale)

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      user:       { select: { fullName: true, email: true, phone: true, whatsapp: true, address: { select: { type: true, fullAddress: true, postalCode: true, provinceId: true, regencyId: true, districtId: true, villageId: true, countryCode: true, city: true, stateRegion: true } } } },
      hotels:     { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } } } } } },
      transports: { include: { transportQuota: { include: { pricing: { include: { trip: true, vehicle: true } } } } } },
      muthowif:   { include: { muthowif: true } },
      catering:   { include: { cateringOption: true } },
      haji:       { include: { hajiProduct: { select: { name: true } } } },
      tourPackages: { include: { tourPackage: true, transportQuota: { include: { pricing: { include: { vehicle: true } } } } } },
      flights:    { include: { flightSchedule: { include: { route: true } } } },
      packages:   { include: { package: { select: { name: true } } } },
      pilgrims:   { orderBy: { id: 'asc' }, select: { ...BOOKING_PILGRIM_SAFE_SELECT, visaApplication: { include: { visaProduct: true } } } }, // kolom tersegel tak pernah dimuat
      payments:   { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
      invoice:    true,
      groups:     { orderBy: { position: 'asc' }, select: { id: true, label: true, position: true, plannedTravelDate: true } },
    },
  })
  if (!booking) notFound()
  if (booking.status === 'draft') redirect(`/${locale}/admin/bookings/drafts/${id}`) // draf diedit di editor draf (§10.3)

  // Tabel jamaah (pemilik 2026-11-10): satu pemuat bersama halaman jamaah (lib/pilgrims/slots.ts). Halaman ini MEMERIKSA satu jamaah sekaligus
  // (`?periksa=<id>`; bawaan = jamaah pertama yang menunggu pemeriksaan); mengubah data/dokumen di halaman Kelola jamaah.
  const { slots, checklists } = await bookingPilgrimSlots(id, booking.departureDate, booking.pilgrims)
  const reviewHistory = await reviewHistoryOf(booking.pilgrims.map(p => p.id), true, session.userId)
  const selectedId = booking.pilgrims.some(p => p.id === periksa) ? periksa : booking.pilgrims.find(p => p.reviewStatus === 'submitted')?.id
  const selected = booking.pilgrims.find(p => p.id === selectedId)
  const selectedSlot = slots.find(x => x.id === selectedId)
  const manageHref = (pid: string) => `/${locale}/admin/bookings/${id}/pilgrims/${pid}`
  const nextEmpty = slots.find(x => !x.filled)
  // Visa per jamaah diringkas: produk + harga satuan sama → satu baris "3 jamaah × Rp … = Rp …" (lib/booking/orderSummary.ts), harga = jual beku berlaku.
  const sells = await itemSellTotals(prisma, booking.id)
  // Rombongan (§10.8, 11d-2b): nama dirender dari label hidup; booking tanpa rombongan = tampilan lama (tanpa label).
  const gv = groupView(booking.groups)
  const pilgrimGroup = new Map(booking.pilgrims.map(p => [p.id, p.groupId]))
  const tag = (groupId: string | null) => (gv ? <span className="admin-badge-gray ml-2 align-middle">{gv.name(groupId)}</span> : null)
  const visaRows = collapseRows(booking.pilgrims.flatMap(p => p.visaApplication
    ? [{ groupId: p.groupId, group: `visa|${p.groupId ?? ''}`, name: p.visaApplication.visaProduct?.name ?? 'Visa', detail: p.visaApplication.selectedDurationDays ? `${p.visaApplication.selectedDurationDays} hari` : '', unit: 'jamaah', amount: sells.get(`visa:${p.visaApplication.id}`) ?? 0 }]
    : []))

  const st      = displayStatus({ status: booking.status, confirmedAt: booking.confirmedAt, hasPendingPayment: booking.payments.some(p => p.status === 'pending'), departureDate: booking.departureDate, returnDate: booking.returnDate })
  const cfg     = BOOKING_STATUS[st]
  const pendingPayment = st === 'payment_review' ? booking.payments.find(p => p.status === 'pending') : undefined
  const bill    = billOf(booking)
  const noBank  = booking.status === 'active' && !booking.confirmedAt && !!booking.invoice && (await payableBanks(booking.invoice.bankSnapshot as BankSnapshot[])).length === 0
  const revRows = await prisma.bookingRevision.findMany({ where: { bookingId: id }, orderBy: [{ revision: 'desc' }, { id: 'desc' }], take: 100 }) // riwayat satu booking: 100 terbaru
  const revStaff = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(revRows.map(r => r.byUserId))] } }, select: { id: true, fullName: true }, take: 100 })).map(u => [u.id, u.fullName]))
  const revisions = revRows.map(r => ({ ...r, totalBefore: Number(r.totalBefore), totalAfter: Number(r.totalAfter), taxBefore: Number(r.taxBefore), taxAfter: Number(r.taxAfter), byName: revStaff.get(r.byUserId) ?? null }))

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
        {booking.status === 'active' && booking.invoice && (
          <Link href={`/${locale}/admin/bookings/${booking.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-admin-line px-3 py-1.5 text-[12px] font-medium text-admin-ink/80 hover:text-admin-ink hover:bg-white hover:shadow-admin transition-colors">
            <Pencil className="h-3.5 w-3.5" /> Edit booking
          </Link>
        )}
        <span className={STATUS_BADGE[st] ?? 'admin-badge-gray'}>
          {cfg.label}
        </span>
      </div>

      {/* Payment confirmation */}
      <PaymentActions payment={pendingPayment ? { id: pendingPayment.id, hasProof: !!pendingPayment.buktiTransferPath } : null} billTotal={bill.grandTotal} />

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

        <InvoiceBox bookingId={booking.id} bill={bill} noBank={noBank} invoice={booking.invoice && { ...booking.invoice, taxLines: booking.invoice.taxLines as TaxLine[] }} />

        {gv && (
          <div className="admin-card p-4 space-y-2 md:col-span-2">
            <p className="admin-section">Rombongan</p>
            {booking.groups.map(g => (
              <p key={g.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{gv.name(g.id)}</span>
                <span className="text-admin-muted ml-2 text-[12px]">
                  {booking.pilgrims.filter(p => p.groupId === g.id).length} jamaah
                  {g.plannedTravelDate && ` · rencana berangkat ${formatCalendarDate(g.plannedTravelDate, DATE_NUMERIC)}`}
                </span>
              </p>
            ))}
          </div>
        )}

        {booking.hotels.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Hotel</p>
            {booking.hotels.map(h => (
              <p key={h.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{h.hotelRoomSchedule.period.hotel.name}</span>{tag(h.groupId)}
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
                <span className="font-medium text-admin-ink">{bp.package.name}</span>{tag(bp.groupId)}
                {' — '}
                <span>{formatCalendarDate(bp.departureDate, DATE_NUMERIC)} – {formatCalendarDate(bp.returnDate, DATE_NUMERIC)}</span>
                <span className="text-admin-muted ml-2 text-[12px]">{bp.numPeople} orang</span>
              </p>
            ))}
          </div>
        )}

        {booking.flights.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Tiket Pesawat</p>
            {booking.flights.map(bf => (
              <p key={bf.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{bf.flightSchedule.route.origin} → {bf.flightSchedule.route.destination}</span>{tag(bf.groupId)}
                {' — '}
                <span>{formatCalendarDate(bf.departureDate, DATE_NUMERIC)}</span>
                <span className="text-admin-muted ml-2 text-[12px]">{bf.numPassengers} penumpang</span>
              </p>
            ))}
          </div>
        )}

        {booking.tourPackages.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Paket Ziarah</p>
            {booking.tourPackages.map(tp => (
              <p key={tp.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{tp.tourPackage.name}</span>{tag(tp.groupId)}
                {' — '}
                <span>{formatCalendarDate(tp.tourDate, DATE_NUMERIC)}</span>
                <span className="text-admin-muted ml-2 text-[12px]">
                  {tp.numPeople} orang{tp.transportQuota ? ` · ${tp.transportQuota.pricing.vehicle.name}` : ''}
                </span>
              </p>
            ))}
          </div>
        )}

        {booking.transports.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Transport</p>
            {booking.transports.map(bt => (
              <div key={bt.id} className="space-y-0.5">
                <p className="text-[13px] text-admin-ink/80">
                  <span className="font-medium text-admin-ink">{bt.transportQuota.pricing.trip.name}</span>{tag(bt.groupId)}
                  {' — '}
                  <span>{formatCalendarDate(bt.travelDate, DATE_NUMERIC)}</span>
                  <span className="text-admin-muted ml-2 text-[12px]">{bt.transportQuota.pricing.vehicle.name} · {bt.numPassengers} penumpang</span>
                </p>
                {(bt.pickupDetail || bt.dropoffDetail) && (
                  <p className="text-[12px] text-admin-muted">{bt.pickupDetail ?? '-'} → {bt.dropoffDetail ?? '-'}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {booking.catering.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Katering</p>
            {booking.catering.map(bc => (
              <p key={bc.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{bc.cateringOption.name}</span>{tag(bc.groupId)}
                {' — '}
                <span>{formatCalendarDate(bc.startDate, DATE_NUMERIC)} – {formatCalendarDate(bc.endDate, DATE_NUMERIC)}</span>
                <span className="text-admin-muted ml-2 text-[12px]">{bc.numDays} hari × {bc.numPeople} orang</span>
              </p>
            ))}
          </div>
        )}

        {booking.haji.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Haji</p>
            {booking.haji.map(bh => (
              <p key={bh.id} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{bh.hajiProduct.name}</span>{tag(bh.groupId)}
                <span className="text-admin-muted ml-2 text-[12px]">{bh.numPersons} orang</span>
              </p>
            ))}
          </div>
        )}

        {visaRows.length > 0 && (
          <div className="admin-card p-4 space-y-2">
            <p className="admin-section">Visa</p>
            {visaRows.map(r => (
              <p key={r.key} className="text-[13px] text-admin-ink/80">
                <span className="font-medium text-admin-ink">{r.name}</span>{tag(r.first.groupId)}
                {r.detail && <span className="text-admin-muted ml-2 text-[12px]">{r.detail}</span>}
                <span className="block text-[12px] text-admin-muted tabular-nums">
                  {formulaOf(r, formatRupiah) ?? `1 ${r.unit}`} = <span className="font-semibold text-admin-ink">{formatRupiah(r.amount)}</span>
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
                  <span className="text-admin-muted ml-2 text-[12px]">{bm.numDays} hari × {bm.numPeople} orang</span>{tag(bm.groupId)}
                </p>
                {bm.muthowif ? (
                  <p className="text-[13px] text-admin-ink">
                    <span className="font-medium">{bm.muthowif.name}</span>
                    <span className="text-admin-muted ml-2 text-[12px]">
                      di-assign {bm.assignedAt ? formatInstant(bm.assignedAt, DATE_NUMERIC) : '-'}
                    </span>
                  </p>
                ) : (
                  <MuthowifAssignPanel bookingId={id} bookingMuthowifId={bm.id} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Harga: tiga total + atur total (semua admin) + pengeluaran aktual vendor (manager+; daftar vendor hanya terbuka untuk manager+) */}
      <BookingPriceCard bookingId={id} status={st} />
      {canRecordCost(session.role) && <CostActualsPanel bookingId={id} />}
      <RevisionHistory rows={revisions} />

      {/* Jamaah: tabel (kelengkapan per slot) + pemeriksaan SATU jamaah terpilih */}
      <div id="jamaah" className="admin-card overflow-hidden scroll-mt-20">
        <div className="px-5 py-3.5 border-b border-admin-line">
          <span className="text-[14px] font-bold text-admin-ink">Jamaah ({booking.pilgrims.length} orang)</span>
        </div>
        <div className="p-5">
          <PilgrimSlotsTable
            total={slots.length}
            slots={slots.map(x => ({ ...x, ...(gv && { group: gv.name(pilgrimGroup.get(x.id)) }), editHref: manageHref(x.id), viewHref: `/${locale}/admin/bookings/${id}?periksa=${x.id}#periksa` }))}
            addHref={booking.status === 'active' && nextEmpty ? manageHref(nextEmpty.id) : null}
            deleteEndpoint={booking.status === 'active' ? `/api/v1/admin/bookings/${id}/pilgrims/{id}` : null}
          />
        </div>
      </div>

      {selected && selectedSlot ? (() => {
        const check = checklists.get(selected.id)
        const visaCfg = VISA_STATUS[selected.visaApplication?.status as keyof typeof VISA_STATUS]
        return (
          <div id="periksa" className="admin-card overflow-hidden scroll-mt-20">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-admin-line px-5 py-3.5">
              <div>
                <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">Pemeriksaan jamaah {selectedSlot.no} dari {slots.length}</p>
                <p className="m-0 mt-0.5 text-[14px] font-bold text-admin-ink">{selectedSlot.name ?? `Jamaah ${selectedSlot.no}`}</p>
                <p className="m-0 mt-0.5 text-[11px] text-admin-muted">{selected.visaApplication?.visaProduct?.name ?? VISA_TYPE_LABEL[selected.visaApplication?.visaType ?? ''] ?? 'Tanpa visa'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {visaCfg && <span className={VISA_BADGE[selected.visaApplication?.status ?? ''] ?? 'admin-badge-gray'}>{visaCfg.label}</span>}
                {/* Halaman ini untuk MEMERIKSA; mengubah kartu/data/dokumen di halaman Kelola jamaah (per jamaah — pemilik 2026-11-10). */}
                <Link href={manageHref(selected.id)} className="admin-btn-sm inline-flex items-center gap-1.5">
                  <UserCog className="h-3.5 w-3.5" /> Kelola data &amp; dokumen
                </Link>
              </div>
            </div>
            <div className="space-y-3 p-5">
              <PilgrimReviewPanel
                key={selected.id}
                bookingId={id}
                pilgrimId={selected.id}
                status={selected.reviewStatus}
                active={booking.status === 'active'}
                linked={!!selected.savedPilgrimId}
                documents={(check?.documents ?? []).map(d => ({ ...d, requirementState: check?.items.find(i => i.documentTypeId === d.documentTypeId)?.state ?? null }))}
                history={reviewHistory.get(selected.id) ?? []}
                data={selectedSlot.rows}
                requirements={(check?.items ?? []).map(i => ({ documentTypeId: i.documentTypeId, label: i.label, required: i.required, reusable: i.reusable }))}
              />
              {selected.visaApplication && (
                <VisaActions pilgrimId={selected.id} visaAppId={selected.visaApplication.id} currentStatus={selected.visaApplication.status} />
              )}
            </div>
          </div>
        )
      })() : (
        <p className="m-0 rounded-xl border border-dashed border-admin-line px-5 py-4 text-[13px] text-admin-muted">
          Pilih ikon <span className="font-semibold text-admin-ink">Lihat</span> pada tabel jamaah untuk memeriksa data dan dokumennya.
        </p>
      )}
    </div>
  )
}
