import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Clock, FileText } from 'lucide-react'
import type { PilgrimReviewStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { ManageBox } from './ManageBox'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'
import { BOOKING_PILGRIM_SAFE_SELECT, bookingChecklists } from '@/lib/pilgrims/bookingLink'
import { cardIdSchema } from '@/lib/pilgrims/http'
import { REVIEW_LABEL, isReviewLocked } from '@/lib/pilgrims/reviewState'
import { cardBoundKeys } from '@/lib/manifest/roles'
import { completeness } from '@/lib/manifest/values'
import { getFieldByRole, getManifestFieldRequirements } from '@/lib/manifest/getRequirements'
import { CORE_MANIFEST_PRODUCT_ID, CORE_MANIFEST_PRODUCT_TYPE } from '@/lib/manifest/constants'
import { calendarDateOf } from '@/lib/time'
import { PilgrimCardPanel } from './PilgrimCardPanel'
import { PilgrimDataForm } from './PilgrimDataForm'
import { DocumentsBox } from './DocumentsBox'

// Kelola SATU jamaah booking (permintaan pemilik 2026-11-10): halaman booking hanya untuk MEMERIKSA, mengubah data/dokumen di halaman ini —
// per jamaah supaya tidak ribet. Kiri: kartu, data jamaah booking ini, dokumen pribadi, dokumen perjalanan (semua tersimpan sendiri-sendiri
// lewat route admin yang sudah ada). Kanan: status pemeriksaan + kelengkapan + pindah ke jamaah lain. Selama diajukan/terverifikasi semuanya
// hanya-baca (server juga menolak — isReviewLocked).

type Props = { params: Promise<{ locale: string; id: string; pilgrimId: string }> }

const TONE: Record<PilgrimReviewStatus, BadgeTone> = { draft: 'neutral', submitted: 'warning', needs_revision: 'danger', verified: 'ok' }
const DONE = new Set(['pending', 'accepted'])

export default async function ManagePilgrimPage({ params }: Props) {
  const { locale, id, pilgrimId } = await params
  await requireAdminPage(locale)
  if (!cardIdSchema.safeParse(id).success || !cardIdSchema.safeParse(pilgrimId).success) notFound()

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true, bookingCode: true, status: true, userId: true, departureDate: true,
      user: { select: { fullName: true, email: true, phone: true, whatsapp: true, address: { select: { type: true, fullAddress: true, postalCode: true, provinceId: true, regencyId: true, districtId: true, villageId: true, countryCode: true, city: true, stateRegion: true } } } },
      pilgrims: { orderBy: { id: 'asc' }, select: { ...BOOKING_PILGRIM_SAFE_SELECT, visaApplication: { select: { visaProductId: true, plannedTravelDate: true, visaProduct: { select: { name: true } } } } } },
    },
  })
  if (!booking) notFound()
  if (booking.status === 'draft') redirect(`/${locale}/admin/bookings/drafts/${id}`)
  const index = booking.pilgrims.findIndex(p => p.id === pilgrimId)
  const p = booking.pilgrims[index]
  if (!p) notFound()

  const fieldsOf = (q: typeof p) => q.visaApplication?.visaProductId
    ? getManifestFieldRequirements('visa', q.visaApplication.visaProductId)
    : getManifestFieldRequirements(CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID)
  const fieldsAll = await Promise.all(booking.pilgrims.map(fieldsOf))
  const nameOf = (i: number) => {
    const q = booking.pilgrims[i]!
    const n = getFieldByRole(fieldsAll[i] ?? [], (q.fieldValues ?? {}) as Record<string, unknown>, 'display_name')
    return typeof n === 'string' && n ? n : `Jamaah ${i + 1}`
  }
  const fields = [...(fieldsAll[index] ?? [])].sort((a, b) => a.order - b.order)
  const values = (p.fieldValues ?? {}) as Record<string, unknown>
  const data = completeness(fields, values)

  const checks = await bookingChecklists(id, booking.departureDate ? calendarDateOf(booking.departureDate) : null, booking.pilgrims.map(q => ({
    id: q.id, savedPilgrimId: q.savedPilgrimId,
    plannedTravelDate: q.visaApplication?.plannedTravelDate ? calendarDateOf(q.visaApplication.plannedTravelDate) : null,
  })))
  const check = checks.get(p.id)
  const items = check?.items ?? []
  const personal = items.filter(i => i.reusable)
  const trip = items.filter(i => !i.reusable)
  const required = items.filter(i => i.required)
  const docsDone = required.filter(i => DONE.has(i.state)).length

  const selfCard = await prisma.savedPilgrim.findFirst({ where: { selfOfUserId: booking.userId, archivedAt: null }, select: { id: true } })
  const u = booking.user
  const self = {
    cardId: selfCard?.id ?? null,
    usedHere: !!selfCard && booking.pilgrims.some(q => q.savedPilgrimId === selfCard.id),
    fullName: u.fullName, email: u.email, phone: u.phone, whatsapp: u.whatsapp,
    address: u.address ? { ...u.address, postalCode: u.address.postalCode ?? '', city: u.address.city ?? '', stateRegion: u.address.stateRegion ?? '' } : null,
  }

  const locked = isReviewLocked(p.reviewStatus)
  const closed = booking.status !== 'active'
  const readOnly = locked || closed
  const linked = check?.card ?? null
  const base = `/api/v1/admin/bookings/${id}/pilgrims/${p.id}`
  const bookingHref = `/${locale}/admin/bookings/${id}`

  const docsHint = (list: typeof items) => list.length === 0 ? null : `${list.filter(i => DONE.has(i.state)).length} dari ${list.length} diunggah`
  const noCard = <p className="m-0 text-[13px] text-admin-muted">Tautkan atau buat kartu jamaah dulu (kotak Kartu jamaah di atas), lalu dokumen bisa diunggah di sini.</p>

  return (
    <EditorShell
      backHref={`${bookingHref}?periksa=${p.id}#periksa`}
      backLabel={`Kembali ke booking ${booking.bookingCode}`}
      banner={readOnly ? (
        <p role="note" className="m-0 flex items-start gap-2 rounded-xl border border-admin-warning/30 bg-admin-warning/10 px-4 py-3 text-[13px] text-admin-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-admin-warning" />
          <span>
            {closed
              ? 'Booking ini tidak aktif — data jamaah hanya bisa dilihat.'
              : <>Data jamaah ini {p.reviewStatus === 'verified' ? 'sudah terverifikasi' : 'sedang diperiksa'}, jadi dikunci. Untuk mengubah, kembalikan dulu di <Link href={`${bookingHref}?periksa=${p.id}#periksa`} className="font-semibold text-admin-accent hover:underline">Pemeriksaan data</Link>.</>}
          </span>
        </p>
      ) : undefined}
      title={(
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">Kelola jamaah {index + 1} dari {booking.pilgrims.length}</p>
          <h1 className="m-0 mt-0.5 text-xl font-bold text-admin-ink">{nameOf(index)}</h1>
          {p.visaApplication?.visaProduct && <p className="m-0 mt-0.5 text-[12px] text-admin-muted">{p.visaApplication.visaProduct.name}</p>}
        </div>
      )}
      main={(
        <>
          <ManageBox title="Kartu jamaah" icon="card" description="Data pribadi milik pelanggan, dipakai lagi untuk pesanan berikutnya.">
            <PilgrimCardPanel locale={locale} bookingId={id} pilgrimId={p.id} customerId={booking.userId} linked={linked} self={self} locked={readOnly} />
          </ManageBox>
          <ManageBox title="Data jamaah untuk booking ini" icon="data" description="Isian sesuai produk; perubahan di sini tidak mengubah kartu.">
            <PilgrimDataForm
              key={JSON.stringify(p.fieldValues)}
              bookingId={id}
              pilgrimId={p.id}
              cardBound={p.savedPilgrimId ? cardBoundKeys(fields) : []}
              fields={fields.map(f => ({ id: f.id, fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType, options: f.options, required: f.required, role: f.role, order: f.order }))}
              initial={values}
              plannedTravelDate={p.visaApplication ? (p.visaApplication.plannedTravelDate ? calendarDateOf(p.visaApplication.plannedTravelDate) : null) : undefined}
              locked={readOnly}
            />
          </ManageBox>
          {personal.length > 0 && (
            <ManageBox title="Dokumen pribadi" icon="personal" description="Yang diminta produk booking ini. Tersimpan di kartu jamaah." aside={<span className="text-[11px] text-admin-muted">{docsHint(personal)}</span>}>
              {linked ? <DocumentsBox endpoint={`/api/v1/admin/customers/${booking.userId}/pilgrims/${linked.id}/documents`} onlyTypeIds={personal.map(i => i.documentTypeId)} readOnly={readOnly} /> : noCard}
            </ManageBox>
          )}
          {trip.length > 0 && (
            <ManageBox title="Dokumen perjalanan" icon="trip" description="Yang diminta produk booking ini — hanya untuk booking ini." aside={<span className="text-[11px] text-admin-muted">{docsHint(trip)}</span>}>
              {linked ? <DocumentsBox endpoint={`${base}/documents`} readOnly={readOnly} /> : noCard}
            </ManageBox>
          )}
        </>
      )}
      sidebar={(
        <>
          <ManageBox title="Status" collapsible={false}>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-admin-muted">Pemeriksaan</span>
              <Badge tone={TONE[p.reviewStatus]}>{REVIEW_LABEL[p.reviewStatus]}</Badge>
            </div>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-admin-muted">Data wajib</span>
              <Badge tone={data.complete ? 'ok' : 'warning'}>{data.filled}/{data.required}</Badge>
            </div>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-admin-muted">Dokumen wajib</span>
              <Badge tone={docsDone === required.length ? 'ok' : 'warning'}>{docsDone}/{required.length}</Badge>
            </div>
            {items.length > 0 && (
              <ul className="m-0 list-none space-y-1.5 border-t border-admin-line p-0 pt-3">
                {items.map(i => (
                  <li key={i.key} className="flex items-center gap-2 text-[12px] text-admin-ink">
                    {i.state === 'accepted' ? <CheckCircle2 className="size-3.5 shrink-0 text-admin-ok" />
                      : i.state === 'pending' ? <Clock className="size-3.5 shrink-0 text-admin-warning" />
                      : i.state === 'missing' ? <FileText className="size-3.5 shrink-0 text-admin-muted" />
                      : <AlertTriangle className="size-3.5 shrink-0 text-admin-danger" />}
                    <span className="min-w-0 flex-1 truncate">{i.label}{i.required ? '' : ' (opsional)'}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`${bookingHref}?periksa=${p.id}#periksa`} className="block text-[12px] font-semibold text-admin-accent hover:underline">Buka Pemeriksaan data →</Link>
          </ManageBox>
          {booking.pilgrims.length > 1 && (
            <ManageBox title="Jamaah di booking ini" icon="users" collapsible={false}>
              <ul className="m-0 list-none space-y-1 p-0">
                {booking.pilgrims.map((q, i) => (
                  <li key={q.id}>
                    {q.id === p.id
                      ? <span className="flex items-center justify-between gap-2 rounded-lg bg-admin-spot px-2.5 py-1.5 text-[13px] font-semibold text-admin-ink">{nameOf(i)}<Badge tone={TONE[q.reviewStatus]}>{REVIEW_LABEL[q.reviewStatus]}</Badge></span>
                      : <Link href={`/${locale}/admin/bookings/${id}/pilgrims/${q.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-admin-ink hover:bg-admin-spot">{nameOf(i)}<Badge tone={TONE[q.reviewStatus]}>{REVIEW_LABEL[q.reviewStatus]}</Badge></Link>}
                  </li>
                ))}
              </ul>
            </ManageBox>
          )}
        </>
      )}
    />
  )
}
