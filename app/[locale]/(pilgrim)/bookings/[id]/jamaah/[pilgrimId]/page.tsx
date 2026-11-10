import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { safeLocale } from '@/lib/utils/locale'
import { Badge } from '@/components/ui/badge'
import { BOOKING_PILGRIM_SAFE_SELECT } from '@/lib/pilgrims/bookingLink'
import { bookingPilgrimSlots } from '@/lib/pilgrims/slots'
import { reviewHistoryOf } from '@/lib/pilgrims/review'
import { cardIdSchema } from '@/lib/pilgrims/http'
import { REVIEW_LABEL, REVIEW_TONE } from '@/lib/pilgrims/reviewState'
import { cardBoundKeys } from '@/lib/manifest/roles'
import { isEmptyValue } from '@/lib/manifest/values'
import { PilgrimTripPanel } from '../../PilgrimTripPanel'

// Isi / edit SATU jamaah booking milik pemesan (pemilik 2026-11-10: tabel jamaah di halaman booking, fokus per jamaah di sini). Isinya panel yang
// sama dengan sebelumnya (PilgrimTripPanel: pilih dari Jamaah Saya / tambah baru / diri sendiri, kelengkapan + unggah dokumen, ajukan).

type Props = { params: Promise<{ locale: string; id: string; pilgrimId: string }> }

export default async function BookingPilgrimPage({ params }: Props) {
  const { locale, id, pilgrimId } = await params
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)
  if (!cardIdSchema.safeParse(id).success || !cardIdSchema.safeParse(pilgrimId).success) notFound()

  const booking = await prisma.booking.findFirst({
    where: { id, userId: session.userId, status: { not: 'draft' } }, // draf = urusan admin, tak tampil ke jamaah
    select: {
      id: true, bookingCode: true, status: true, departureDate: true,
      pilgrims: { orderBy: { id: 'asc' }, select: { ...BOOKING_PILGRIM_SAFE_SELECT, visaApplication: { select: { visaProductId: true, plannedTravelDate: true, visaProduct: { select: { name: true } } } } } },
    },
  })
  if (!booking) notFound()
  const index = booking.pilgrims.findIndex(p => p.id === pilgrimId)
  const p = booking.pilgrims[index]
  if (!p) notFound()

  const { slots, checklists, fieldsByPilgrim } = await bookingPilgrimSlots(booking.id, booking.departureDate, booking.pilgrims)
  const slot = slots[index]!
  const check = checklists.get(p.id)
  const fields = fieldsByPilgrim.get(p.id) ?? []
  const bound = new Set(cardBoundKeys(fields))
  const values = (p.fieldValues ?? {}) as Record<string, unknown>
  const missingFields = fields.filter(f => f.required && isEmptyValue(values[f.fieldKey])).map(f => ({ label: f.label, fromCard: bound.has(f.fieldKey) }))
  // Catatan perbaikan terakhir dari petugas — nama petugas tidak dikirim ke pemesan.
  const history = (await reviewHistoryOf([p.id], false)).get(p.id) ?? []

  // Pemesan sebagai jamaah: kartu "Saya sendiri" (dibaca saja — kartu ditulis hanya lib/pilgrims/service.ts) + data akun untuk mengisi kartu baru.
  const [account, selfCard] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId }, select: { fullName: true, email: true, phone: true, whatsapp: true, address: { select: { type: true, fullAddress: true, postalCode: true, provinceId: true, regencyId: true, districtId: true, villageId: true, countryCode: true, city: true, stateRegion: true } } } }),
    prisma.savedPilgrim.findFirst({ where: { selfOfUserId: session.userId, archivedAt: null }, select: { id: true } }),
  ])
  const self = {
    cardId: selfCard?.id ?? null,
    usedHere: !!selfCard && booking.pilgrims.some(q => q.savedPilgrimId === selfCard.id),
    fullName: account?.fullName ?? '', email: account?.email ?? '', phone: account?.phone ?? null, whatsapp: account?.whatsapp ?? null,
    address: account?.address ? { ...account.address, postalCode: account.address.postalCode ?? '', city: account.address.city ?? '', stateRegion: account.address.stateRegion ?? '' } : null,
  }

  const href = (pid: string) => `/${locale}/bookings/${booking.id}/jamaah/${pid}`
  const prev = booking.pilgrims[index - 1]
  const next = booking.pilgrims[index + 1]

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="space-y-3">
        <Link href={`/${locale}/bookings/${booking.id}#data-jamaah`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke booking {booking.bookingCode}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jamaah {index + 1} dari {booking.pilgrims.length}</p>
            <h1 className="text-2xl font-bold">{slot.name ?? `Jamaah ${index + 1}`}</h1>
            {p.visaApplication?.visaProduct && <p className="text-sm text-muted-foreground">{p.visaApplication.visaProduct.name}</p>}
          </div>
          <Badge variant={REVIEW_TONE[p.reviewStatus]}>{REVIEW_LABEL[p.reviewStatus]}</Badge>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <PilgrimTripPanel
          locale={safeLocale(locale)} bookingId={booking.id} pilgrimId={p.id}
          linked={check?.card ?? null}
          checklist={(check?.items ?? []).map(i => ({ key: i.key, documentTypeId: i.documentTypeId, label: i.label, required: i.required, state: i.state, sources: i.sources ?? [], reusable: i.reusable, validUntilNeeded: i.validUntilNeeded }))}
          review={{
            status: p.reviewStatus,
            open: booking.status === 'active',
            ready: check?.ready ?? false,
            note: p.reviewStatus === 'needs_revision' ? (history.find(h => h.to === 'needs_revision')?.note ?? null) : null,
          }}
          self={self}
          missingFields={missingFields}
        />
      </div>

      <nav aria-label="Jamaah lain" className="flex items-center justify-between gap-3 text-sm">
        {prev
          ? <Link href={href(prev.id)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /> {slots[index - 1]?.name ?? `Jamaah ${index}`}</Link>
          : <span />}
        {next && (
          <Link href={href(next.id)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">{slots[index + 1]?.name ?? `Jamaah ${index + 2}`} <ChevronRight className="h-4 w-4" /></Link>
        )}
      </nav>
    </div>
  )
}
