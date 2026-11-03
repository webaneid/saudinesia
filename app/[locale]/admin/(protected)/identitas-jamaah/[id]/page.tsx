import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { PilgrimMatchStatus } from '@prisma/client'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { getIdentity, type IdentityDetail } from '@/lib/pilgrims/warehouse'
import { REVIEW_LABEL } from '@/lib/pilgrims/reviewState'
import { DATE_LONG, DATETIME_LONG, formatCalendarDate, formatInstant } from '@/lib/time'
import { CardActions } from './CardActions'
import { EraseIdentity } from './EraseIdentity'
import { MergeBox } from './MergeBox'
import { RevealNik } from './RevealNik'

// Satu identitas jamaah (docs/arsitektur-jamaah.md §4.4, Fase 8): data kanonik, kartu akun yang menautnya (status dihitung saat dibaca), riwayat
// booking, jejak; Buka NIK (berjejak), Gabung, Hapus. Semua aturan di lib/pilgrims/warehouse.ts. MetaBox = komponen klien: jangan kirim `icon` dari sini.
type Props = { params: Promise<{ locale: string; id: string }> }
type Card = IdentityDetail['cards'][number]

const STATUS: Record<PilgrimMatchStatus, { label: string; tone: BadgeTone }> = {
  matched: { label: 'Cocok', tone: 'ok' }, conflict: { label: 'Konflik', tone: 'danger' }, unmatched: { label: 'Tanpa identitas', tone: 'neutral' },
}
const EVENT: Record<string, string> = {
  created: 'Identitas dibuat', linked: 'Kartu ditautkan', conflict: 'Kartu konflik', detached: 'Kartu dilepas', merged: 'Identitas digabung',
  nik_revealed: 'NIK dibuka', passport_revealed: 'Paspor dibuka', match_confirmed: 'Ditandai orang yang sama', canonical_updated: 'Data kanonik diperbarui',
}
const GENDER = { male: 'Laki-laki', female: 'Perempuan' } as const

export default async function IdentityDetailPage({ params }: Props) {
  const { locale, id } = await params
  const session = await requireAdminPage(locale)
  const d = /^[0-9a-f-]{36}$/i.test(id) ? await getIdentity({ userId: session.userId, role: session.role }, id) : null
  if (!d) notFound()

  const cardColumns: Column<Card>[] = [
    {
      key: 'card', header: 'Kartu', mobile: 'title',
      cell: c => (
        <>
          <span className="text-[13px] font-semibold text-admin-ink">{c.fullName}{c.archived ? ' (diarsipkan)' : ''}</span>
          <div className="text-[12px] text-admin-muted">
            Lahir {c.birthDate ? formatCalendarDate(c.birthDate, DATE_LONG) : '-'} · Pemilik:{' '}
            <Link href={`/${locale}/admin/customers/${c.ownerId}`} className="text-admin-accent hover:text-admin-accent-strong">{c.ownerName ?? c.ownerEmail}</Link>
            {c.passport ? ` · Paspor ${c.passport}` : ''}
          </div>
        </>
      ),
    },
    {
      key: 'status', header: 'Status',
      cell: c => <span className="flex flex-wrap gap-1"><Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>{c.confirmed && <Badge tone="neutral">Cocok manual</Badge>}</span>,
    },
    {
      key: 'actions', header: '', actions: true,
      cell: c => <RowActions><CardActions identityId={d.id} cardId={c.id} name={c.fullName} status={c.status} confirmed={c.confirmed} hasPassport={c.passport !== null} /></RowActions>,
    },
  ]
  const bookingColumns: Column<IdentityDetail['bookings'][number]>[] = [
    { key: 'code', header: 'Booking', mobile: 'title', cell: b => <Link href={`/${locale}/admin/bookings/${b.bookingId}`} className="font-mono text-[12px] font-semibold text-admin-accent hover:text-admin-accent-strong">{b.bookingCode}</Link> },
    { key: 'review', header: 'Pemeriksaan', cell: b => <span className="text-[12px]">{REVIEW_LABEL[b.reviewStatus]}</span> },
    { key: 'actions', header: '', actions: true, cell: b => <RowActions><ActionLink kind="view" href={`/${locale}/admin/bookings/${b.bookingId}`} label={`Lihat booking ${b.bookingCode}`} /></RowActions> },
  ]

  const conflicts = d.cards.filter(c => c.status === 'conflict').length
  return (
    <EditorShell
      backHref={`/${locale}/admin/identitas-jamaah`} backLabel="Identitas Jamaah"
      title={<h1 className="m-0 text-xl font-extrabold tracking-tight text-admin-ink sm:text-2xl">{d.fullName}</h1>}
      main={(
        <>
          <MetaBox title="Data kanonik" collapsible={false}
            description={d.pinnedAt ? `Ditetapkan petugas ${formatInstant(new Date(d.pinnedAt), DATETIME_LONG)}` : d.verifiedAt ? 'Dari pengajuan yang terverifikasi' : 'Mengikuti kartu tertua (belum terverifikasi)'}>
            <dl className="m-0 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
              {([
                ['Nama', d.fullName], ['Jenis kelamin', d.gender ? GENDER[d.gender] : '-'], ['Tempat lahir', d.birthPlace ?? '-'],
                ['Tanggal lahir', d.birthDate ? formatCalendarDate(d.birthDate, DATE_LONG) : '-'], ['Kewarganegaraan', d.nationality],
                ['Terverifikasi', d.verifiedAt ? formatInstant(new Date(d.verifiedAt), DATETIME_LONG) : 'Belum'],
              ] as const).map(([k, v]) => <div key={k}><dt className="text-[11.5px] text-admin-muted">{k}</dt><dd className="m-0 text-admin-ink">{v}</dd></div>)}
            </dl>
          </MetaBox>
          <MetaBox title="Kartu jamaah" aside={conflicts > 0 ? <Badge tone="danger">{conflicts} konflik</Badge> : undefined}
            description="Kartu di akun pelanggan yang menaut identitas ini. Konflik = NIK sama, nama/tanggal lahir berbeda.">
            <DataTable columns={cardColumns} rows={d.cards} getRowId={c => c.id} empty="Tidak ada kartu yang menaut identitas ini." />
          </MetaBox>
          <MetaBox title="Riwayat booking" description={`${d.bookingsTotal} jamaah booking${d.bookingsTotal > d.bookings.length ? ` (${d.bookings.length} terbaru)` : ''}`}>
            <DataTable columns={bookingColumns} rows={d.bookings} getRowId={b => b.bookingPilgrimId} empty="Belum pernah dipakai booking." />
          </MetaBox>
          <MetaBox title="Jejak" defaultOpen={false} description="Setiap pembukaan NIK/paspor, gabung, dan perubahan tautan tercatat (100 terbaru).">
            <ol className="m-0 list-none space-y-1 p-0 text-[12px] text-admin-muted">
              {d.events.map(e => (
                <li key={e.id}><span className="text-admin-ink">{EVENT[e.kind] ?? e.kind}</span> · {formatInstant(new Date(e.at), DATETIME_LONG)}{e.actorName ? ` · ${e.actorName}` : ''}</li>
              ))}
            </ol>
          </MetaBox>
        </>
      )}
      sidebar={(
        <>
          <MetaBox title={d.keyKind === 'nik' ? 'NIK' : 'Kunci paspor'} collapsible={false}
            description={d.aliases > 0 ? `${d.aliases} kunci lama dari identitas yang digabung` : undefined}>
            {d.nik ? <RevealNik identityId={d.id} masked={d.nik} /> : <p className="m-0 text-[12.5px] text-admin-muted">Identitas WNA — nomor paspor dibuka per kartu.</p>}
          </MetaBox>
          <MetaBox title="Gabung identitas" collapsible={false} description="Untuk orang yang sama yang tercatat dua kali.">
            <MergeBox locale={locale} identityId={d.id} fullName={d.fullName} />
          </MetaBox>
          <EraseIdentity locale={locale} identityId={d.id} usedByBookings={d.bookingsTotal > 0} />
        </>
      )}
    />
  )
}
