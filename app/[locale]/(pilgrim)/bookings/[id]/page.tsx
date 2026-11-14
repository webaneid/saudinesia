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
import { bookingPayTo } from '@/lib/invoice/banks'
import { itemSellTotals, visaTierRanges } from '@/lib/pricing/engine/snapshot'
import { getTranslations } from 'next-intl/server'
import { AlertCircle, ArrowLeft, Building2, Bus, CheckCircle, Clock, FileDown, Landmark, Package, Plane, Stamp, UserRound, UtensilsCrossed } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { displayStatus } from '@/lib/booking/lifecycle'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { BOOKING_PILGRIM_SAFE_SELECT } from '@/lib/pilgrims/bookingLink'
import { bookingPilgrimSlots } from '@/lib/pilgrims/slots'
import { PilgrimSlotsTable } from '@/components/shared/pilgrims/PilgrimSlotsTable'
import { groupView } from '@/lib/booking/groups'
import { DATETIME_FULL, DATE_LONG, DATE_NUMERIC, formatCalendarDate, formatInstant } from '@/lib/time'

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ baru?: string }> }

const SEASONS = ['regular', 'ramadan', 'hajj'] as const
const isSeason = (v: string): v is typeof SEASONS[number] => (SEASONS as readonly string[]).includes(v)

export async function generateMetadata({ params }: Pick<Props, 'params'>) {
  const tm = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'pilgrimArea.booking' })
  return { title: tm('metaTitle') }
}

export default async function BookingDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params
  const justBooked = (await searchParams).baru === '1' // datang dari checkout (docs/arsitektur-booking-engine-v2.md §10.5)
  const lang = safeLocale(locale)
  const t = await getTranslations({ locale: lang, namespace: 'pilgrimArea' })
  const ts = await getTranslations({ locale: lang, namespace: 'shared.bookingStatus' })
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
      groups:     { orderBy: { position: 'asc' }, select: { id: true, label: true, position: true } },
    },
  })
  if (!booking) notFound()
  // Tagihan = subtotal + pajak yang ditambahkan (lib/invoice/bill.ts). Status lunas/sisa tetap mengikuti alur v1 sampai Fase 7.
  const bill = billOf({ totalAmount: booking.totalAmount, invoice: booking.invoice })
  // Harga per item = harga jual beku yang BERLAKU (termasuk harga khusus/revisi), bukan kolom lama baris item.
  const [sells, tiers] = await Promise.all([itemSellTotals(prisma, booking.id), visaTierRanges(prisma, booking.id)])
  const sellOf = (type: string, itemId: string) => sells.get(`${type}:${itemId}`) ?? 0
  // Rekening tujuan = yang DIBEKUKAN di invoice (sama dengan PDF dan route unggah bukti; lib/invoice/banks.ts `bookingPayTo`).
  const payTo = await bookingPayTo(booking.invoice)
  const hasPendingPayment = (await prisma.payment.count({ where: { bookingId: booking.id, status: 'pending' } })) > 0
  const st = displayStatus({ status: booking.status, confirmedAt: booking.confirmedAt, hasPendingPayment, departureDate: booking.departureDate, returnDate: booking.returnDate })

  // Tabel jamaah (pemilik 2026-11-10): kelengkapan per slot dihitung SATU pemuat yang sama dengan admin (lib/pilgrims/slots.ts); isi/edit per jamaah
  // di halaman bookings/[id]/jamaah/[pilgrimId]. Hanya booking aktif yang bisa diisi/dikosongkan.
  const { slots } = await bookingPilgrimSlots(booking.id, booking.departureDate, booking.pilgrims, lang)
  const open = booking.status === 'active'
  const jamaahHref = (pid: string) => `/${locale}/bookings/${booking.id}/jamaah/${pid}`
  const nextEmpty = slots.find(x => !x.filled)

  const day = (d: Date) => formatCalendarDate(d, DATE_NUMERIC, lang)
  const ppl = (count: number) => t('summary.people', { count })
  const pax = (count: number) => t('summary.passengers', { count })
  const days = (count: number) => t('summary.days', { count })
  const tier = (r: { min: number; max: number } | undefined, start: number) => (r ? (r.min === r.max ? days(r.min) : t('summary.visaTier', r)) : days(start))
  // Satu baris per item; baris identik (mis. visa yang sama untuk tiap jamaah) digabung jadi rumus "3 jamaah × Rp …" (lib/booking/orderSummary.ts).
  // Booking berrombongan (§10.8, 11d-2b): nama rombongan (label hidup) mengawali keterangan — baris rombongan berbeda tidak pernah digabung.
  const gv = groupView(booking.groups, { all: t('booking.groupAll'), unnamed: mark => t('booking.groupUnnamed', { mark }) })
  const pilgrimGroup = new Map(booking.pilgrims.map(p => [p.id, p.groupId]))
  const one = (group: string, name: string, detail: string, amount: number, unit: 'order' | 'pilgrim' = 'order', groupId: string | null = null): SummaryInput =>
    ({ group, name, detail: gv ? [gv.name(groupId), detail].filter(Boolean).join(' · ') : detail, unit, amount })
  const sections: SummarySection[] = [
    { icon: Package, title: t('summary.section.package'), rows: collapseRows(booking.packages.map(bp => one('package', bp.package.name, `${day(bp.departureDate)} – ${day(bp.returnDate)} · ${ppl(bp.numPeople)}`, sellOf('package', bp.id), undefined, bp.groupId))) },
    { icon: Landmark, title: t('summary.section.haji'), rows: collapseRows(booking.haji.map(bh => one('haji', bh.hajiProduct.name, ppl(bh.numPersons), sellOf('haji', bh.id), undefined, bh.groupId))) },
    { icon: Plane, title: t('summary.section.flight'), rows: collapseRows(booking.flights.map(bf => one('flight', `${bf.flightSchedule.route.origin} → ${bf.flightSchedule.route.destination}`, `${day(bf.departureDate)} · ${pax(bf.numPassengers)}`, sellOf('flight', bf.id), undefined, bf.groupId))) },
    { icon: Building2, title: t('summary.section.hotel'), rows: collapseRows(booking.hotels.map(h => one('hotel', h.hotelRoomSchedule.period.hotel.name, `${h.hotelRoomSchedule.period.hotel.city} · ${t('summary.nights', { count: h.nights })} · ${t('summary.rooms', { count: h.numRooms, type: h.hotelRoomSchedule.roomType.name })}`, sellOf('hotel', h.id), undefined, h.groupId))) },
    { icon: Bus, title: t('summary.section.transport'), rows: collapseRows(booking.transports.map(bt => one('transport', bt.transportQuota.pricing.trip.name, `${day(bt.travelDate)} · ${bt.transportQuota.pricing.vehicle.name} · ${pax(bt.numPassengers)}`, sellOf('transport', bt.id), undefined, bt.groupId))) },
    { icon: UserRound, title: t('summary.section.muthowif'), rows: collapseRows(booking.muthowif.map(bm => one('muthowif', bm.muthowif?.name ?? t('summary.muthowifService'), `${day(bm.startDate)} – ${day(bm.endDate)} · ${days(bm.numDays)} · ${ppl(bm.numPeople)}`, sellOf('muthowif', bm.id), undefined, bm.groupId))) },
    { icon: UtensilsCrossed, title: t('summary.section.catering'), rows: collapseRows(booking.catering.map(bc => one('catering', bc.cateringOption.name, `${day(bc.startDate)} – ${day(bc.endDate)} · ${days(bc.numDays)} · ${ppl(bc.numPeople)}`, sellOf('catering', bc.id), undefined, bc.groupId))) },
    { icon: Building2, title: t('summary.section.tour'), rows: collapseRows(booking.tourPackages.map(tp => one('tour', tp.tourPackage.name, `${day(tp.tourDate)} · ${ppl(tp.numPeople)}${tp.transportQuota ? ` · ${tp.transportQuota.pricing.vehicle.name}` : ''}`, sellOf('tourPackage', tp.id), undefined, tp.groupId))) },
    { icon: Stamp, title: t('summary.section.visa'), rows: collapseRows(booking.pilgrims.flatMap(p => p.visaApplication ? [one('visa', p.visaApplication.visaProduct?.name ?? t('summary.section.visa'), p.visaApplication.selectedDurationDays ? tier(tiers.get(p.visaApplication.id), p.visaApplication.selectedDurationDays) : '', sellOf('visa', p.visaApplication.id), 'pilgrim', p.groupId)] : [])) },
  ]
  // Diskon/biaya tambahan di total pesanan tidak menempel pada satu layanan: tampil terpisah supaya rincian di atas tetap menjumlah ke tagihan.
  const shownCents = sections.reduce((sum, c) => sum + c.rows.reduce((n, r) => n + Math.round(r.amount * 100), 0), 0)
  const adjustment = (Math.round(bill.subtotal * 100) - shownCents) / 100
  const proofRejected = booking.payments[0]?.status === 'rejected'

  const statusCfg = BOOKING_STATUS[st]
  const season = booking.season
  const deadline = booking.paymentDeadline

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <Link href={`/${locale}/dashboard`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> {t('booking.back')}
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm text-muted-foreground">{t('booking.code')}</p>
            <h1 className="text-3xl font-bold font-mono tracking-wider text-primary">{booking.bookingCode}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusCfg.badge as 'warning' | 'secondary' | 'success' | 'default' | 'destructive' | 'muted'}>
              {ts(st)}
            </Badge>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/v1/bookings/${booking.id}/invoice`} target="_blank" rel="noopener noreferrer">
                <FileDown className="mr-1.5 h-3.5 w-3.5" /> {t('booking.invoice')}
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Baru dipesan dari checkout: langkah berikutnya yang MASIH relevan, tertaut ke bagiannya. */}
      {justBooked && booking.status === 'active' && (
        <div className="rounded-2xl border border-brand/30 bg-brand-light p-5 space-y-3" role="status">
          <p className="flex items-center gap-2 font-bold text-brand-dark"><CheckCircle className="h-5 w-5 text-brand" aria-hidden /> {t('booking.issued')}</p>
          <p className="text-sm text-brand-dark">{t('booking.issuedInvoice')} {st === 'awaiting_payment' ? t('booking.twoSteps') : t('booking.nextStep')}</p>
          <ol className={`grid gap-2 text-sm ${st === 'awaiting_payment' ? 'sm:grid-cols-2' : ''}`}>
            <li><a href="#data-jamaah" className="flex h-full items-start gap-2 rounded-xl bg-white/80 p-3 font-medium text-brand-dark hover:bg-white"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">1</span> {t('booking.stepPilgrims')}</a></li>
            {st === 'awaiting_payment' && <li><a href="#pembayaran" className="flex h-full items-start gap-2 rounded-xl bg-white/80 p-3 font-medium text-brand-dark hover:bg-white"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">2</span> {t('booking.stepPay')}</a></li>}
          </ol>
        </div>
      )}

      {/* Payment notice */}
      {(st === 'awaiting_payment' || st === 'payment_review') && (
        <div id="pembayaran" className="scroll-mt-24 rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            <p className="font-semibold text-amber-800">{t('booking.payTitle')}</p>
          </div>
          {deadline && (
            <p className="text-sm text-amber-700">
              {t.rich('booking.payBefore', { deadline: formatInstant(deadline, DATETIME_FULL, undefined, lang), b: c => <span className="font-bold">{c}</span> })}
            </p>
          )}
          <div className="rounded-lg bg-white/70 p-4 space-y-2 text-sm">
            <p className="font-semibold">{t('booking.transferTo')}</p>
            {payTo.length === 0 && <p className="text-amber-800">{t('booking.noBank')}</p>}
            <div className="grid grid-cols-2 gap-1">
              {payTo.map((b) => (
                <React.Fragment key={`${b.bankName}-${b.accountNumber}`}>
                  <span className="text-muted-foreground">{b.bankName}</span>
                  <span className="font-mono font-bold">{b.accountNumber} <span className="font-sans font-normal text-muted-foreground">{t('booking.holder', { name: b.accountHolder })}</span></span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-amber-900">{formatRupiah(bill.grandTotal)}</p>
          </div>
          {st === 'awaiting_payment' && proofRejected && (
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /> {t('booking.proofRejected')}
            </p>
          )}
          {/* Tanpa rekening tujuan tak ada unggah bukti — pesan "hubungi tim" di atas yang tampil (K3; route unggah juga menolak). */}
          {st === 'awaiting_payment' && payTo.length > 0 && <PaymentProofUpload bookingId={booking.id} />}
          {st === 'payment_review' && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="h-4 w-4" /> {t('booking.proofSent')}
            </div>
          )}
        </div>
      )}

      {/* Trip summary */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold">{t('booking.trip')}</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">{t('booking.departure')}</p><p className="font-semibold">{booking.departureDate ? formatCalendarDate(booking.departureDate, DATE_LONG, lang) : '-'}</p></div>
          <div><p className="text-muted-foreground">{t('booking.return')}</p><p className="font-semibold">{booking.returnDate ? formatCalendarDate(booking.returnDate, DATE_LONG, lang) : '-'}</p></div>
          <div><p className="text-muted-foreground">{t('booking.pilgrimCount')}</p><p className="font-semibold">{t('booking.people', { count: booking.pilgrims.length })}</p></div>
          <div><p className="text-muted-foreground">{t('booking.season')}</p><p className="font-semibold capitalize">{isSeason(season) ? t(`booking.seasons.${season}`) : season}</p></div>
        </div>
      </div>

      {/* Rincian: semua yang ditagih tampil di sini (dijaga scripts/test-payment-path.ts) */}
      <OrderSummaryCard sections={sections} adjustment={adjustment} taxAdded={bill.taxAdded} grandTotal={bill.grandTotal} invoiceNumber={booking.invoice?.number ?? null} />

      {/* Pilgrims + document upload per jamaah */}
      <div id="data-jamaah" className="scroll-mt-24 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <UserRound className="h-4 w-4 text-primary" /> {t('booking.pilgrimsTitle')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('booking.pilgrimsIntro')}</p>
        <PilgrimSlotsTable
          total={slots.length}
          slots={slots.map(x => ({ ...x, ...(gv && { group: gv.name(pilgrimGroup.get(x.id)) }), editHref: jamaahHref(x.id) }))}
          addHref={open && nextEmpty ? jamaahHref(nextEmpty.id) : null}
          deleteEndpoint={open ? `/api/v1/bookings/${booking.id}/pilgrims/{id}` : null}
        />
      </div>

    </div>
  )
}
