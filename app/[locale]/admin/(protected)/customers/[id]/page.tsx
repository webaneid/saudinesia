import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { BOOKING_TONE } from '@/lib/admin/statusTone'
import { CUSTOMER_BOOKINGS_PAGE_SIZE, getCustomer } from '@/lib/customers/query'
import { buildListHref, parseListParams } from '@/lib/admin/pagination'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { ResendInviteButton } from './ResendInviteButton'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { Badge } from '@/components/admin/ui/Badge'
import { Card } from '@/components/admin/ui/Card'
import { formatCalendarDate, formatInstant } from '@/lib/time'

// Detail Pelanggan (docs/arsitektur-pelanggan.md §3) — hanya lihat. Akun non-pilgrim (staf) → 404.

type Props = {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const dt = (d: Date) => formatInstant(d) // INSTAN (dibuat/diverifikasi) di zona aplikasi
const day = (d: Date) => formatCalendarDate(d) // TANGGAL KALENDER (`@db.Date`)

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="m-0 text-[11px] font-semibold text-admin-muted">{label}</p>
      <div className="text-[13px] text-admin-ink">{children}</div>
    </div>
  )
}

export default async function AdminCustomerDetail({ params, searchParams }: Props) {
  const { locale, id } = await params
  await requireAdminPage(locale)
  const sp = await searchParams
  const list = parseListParams(sp, CUSTOMER_BOOKINGS_PAGE_SIZE)
  const inviteFlag = typeof sp.invite === 'string' ? sp.invite : undefined
  const c = await getCustomer(id, list)
  if (!c) notFound()
  const listHref = `/${locale}/admin/customers`

  const bookingColumns: Column<(typeof c.bookings)[number]>[] = [
    { key: 'code', header: 'Kode', mobile: 'title', cell: b => <Link href={`/${locale}/admin/bookings/${b.id}`} className="font-mono text-[12px] font-semibold text-admin-accent hover:text-admin-accent-strong">{b.bookingCode}</Link> },
    { key: 'ordered', header: 'Dipesan', hideBelowLg: true, cell: b => <span className="text-[12px] text-admin-muted">{dt(b.createdAt)}</span> },
    { key: 'departure', header: 'Berangkat', cell: b => <span className="text-[12px] text-admin-muted">{b.departureDate ? day(b.departureDate) : '-'}</span> },
    { key: 'total', header: 'Total', align: 'right', cell: b => <span className="text-[12px] font-medium tabular-nums">{formatRupiah(b.totalAmount)}</span> },
    { key: 'status', header: 'Status', cell: b => <Badge tone={BOOKING_TONE[b.status] ?? 'neutral'}>{BOOKING_STATUS[b.status].label}</Badge> },
    { key: 'actions', header: '', actions: true, cell: b => <RowActions><ActionLink kind="view" href={`/${locale}/admin/bookings/${b.id}`} label={`Lihat booking ${b.bookingCode}`} /></RowActions> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={listHref} aria-label="Kembali ke daftar pelanggan" className="inline-flex size-9 items-center justify-center rounded-xl border border-admin-line bg-white text-admin-muted hover:text-admin-ink"><ArrowLeft className="size-4" /></Link>
        <div>
          <h1 className="m-0 text-xl font-extrabold tracking-tight">{c.deleted ? 'Akun dihapus' : c.fullName}</h1>
          <p className="m-0 text-xs text-admin-muted">Terdaftar {dt(c.createdAt)}</p>
        </div>
        <Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
      </div>

      {inviteFlag && (
        <p role="status" className="m-0 rounded-xl border border-admin-line bg-white px-3 py-2 text-[13px] text-admin-ink">
          {inviteFlag === 'sent' && <>Pelanggan ditambahkan. Email undangan dikirim ke <b>{c.email}</b> — berlaku 7 hari.</>}
          {inviteFlag === 'skipped' && 'Pelanggan ditambahkan, tetapi email undangan belum terkirim (layanan email belum dikonfigurasi atau dibatasi). Kirim dari tombol di bawah.'}
          {inviteFlag === 'failed' && 'Pelanggan ditambahkan, tetapi email undangan gagal dikirim. Kirim ulang dari tombol di bawah.'}
          {inviteFlag === 'none' && 'Pelanggan ditambahkan tanpa undangan. Kirim undangan aktivasi saat siap, dari tombol di bawah.'}
          {!['sent', 'skipped', 'failed', 'none'].includes(inviteFlag) && 'Pelanggan ditambahkan.'}
        </p>
      )}
      {!c.deleted && !c.emailVerified && c.isActive && (
        <Card className="space-y-2 p-4">
          <p className="m-0 text-[13px] font-semibold text-admin-ink">Akun belum diaktifkan</p>
          <p className="m-0 text-[12px] text-admin-muted">Pelanggan belum membuat password, sehingga belum bisa masuk. Undangan berisi tautan membuat password (berlaku 7 hari; tautan lama hangus saat undangan baru dikirim).</p>
          <ResendInviteButton customerId={c.id} />
        </Card>
      )}

      {c.deleted ? (
        <Card className="p-5 text-sm text-admin-muted">Akun ini sudah dihapus sesuai permintaan pemiliknya (UU PDP). Data pribadi sudah dianonimkan; catatan pesanan dan pembayaran (angka dan kode) tetap disimpan.</Card>
      ) : (
        <Card className="space-y-4 p-5">
          <h2 className="m-0 text-sm font-bold text-admin-ink">Profil</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama">{c.fullName}</Field>
            <Field label="Email">{c.email} {c.emailVerified ? <Badge tone="ok">Terverifikasi {c.emailVerifiedAt ? dt(c.emailVerifiedAt) : ''}</Badge> : <Badge tone="warning">Belum verifikasi</Badge>}</Field>
            <Field label="Nomor HP">{c.phone ? `+${c.phone}` : <span className="text-admin-muted">belum diisi</span>}</Field>
            <Field label="WhatsApp">{c.whatsapp ? <>+{c.whatsapp} {c.whatsappVerified ? <Badge tone="ok">Terverifikasi {c.whatsappVerifiedAt ? dt(c.whatsappVerifiedAt) : ''}</Badge> : <Badge tone="neutral">Belum terverifikasi</Badge>}</> : <span className="text-admin-muted">belum diisi</span>}</Field>
            <Field label="Alamat">{c.address ?? <span className="text-admin-muted">belum diisi</span>}</Field>
            <Field label="Cara masuk">{c.googleLinked ? 'Email + Google' : 'Email + password'}</Field>
          </div>
          <p className="m-0 text-[11px] text-admin-muted">Data pribadi — hanya untuk keperluan layanan. Mengubah status akun: Sistem → Pengguna (superadmin).</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="m-0 text-[11px] font-semibold text-admin-muted">Pesanan</p><p className="m-0 text-lg font-bold tabular-nums">{c.bookingCount}</p></Card>
        <Card className="p-4"><p className="m-0 text-[11px] font-semibold text-admin-muted">Total dibayar (terkonfirmasi)</p><p className="m-0 text-lg font-bold tabular-nums">{formatRupiah(c.payments.confirmedIdr)}</p><p className="m-0 text-[11px] text-admin-muted">{c.payments.confirmedCount} pembayaran</p></Card>
        <Card className="p-4"><p className="m-0 text-[11px] font-semibold text-admin-muted">Menunggu / ditolak</p><p className="m-0 text-lg font-bold tabular-nums">{c.payments.pendingCount} / {c.payments.rejectedCount}</p><p className="m-0 text-[11px] text-admin-muted">pembayaran</p></Card>
      </div>

      <div className="space-y-3">
        <h2 className="m-0 text-sm font-bold text-admin-ink">Pesanan</h2>
        <DataTable
          columns={bookingColumns} rows={c.bookings} getRowId={b => b.id} empty="Belum pernah memesan."
          footer={c.bookingsMeta.total > 0 ? <Pagination {...c.bookingsMeta} hrefFor={page => buildListHref(`/${locale}/admin/customers/${c.id}`, { page, limit: list.limit === CUSTOMER_BOOKINGS_PAGE_SIZE ? undefined : list.limit })} /> : undefined}
        />
      </div>
    </div>
  )
}
