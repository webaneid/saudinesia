import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { BOOKING_STATUS } from '@/lib/constants/booking'
import { BOOKING_TONE } from '@/lib/admin/statusTone'
import { getCustomer } from '@/lib/customers/query'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { Badge } from '@/components/admin/ui/Badge'
import { Card } from '@/components/admin/ui/Card'

// Detail Pelanggan (docs/arsitektur-pelanggan.md §3) — hanya lihat. Akun non-pilgrim (staf) → 404.

type Props = { params: Promise<{ locale: string; id: string }> }

const dt = (d: Date) => d.toLocaleDateString('id-ID', { dateStyle: 'medium' })

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="m-0 text-[11px] font-semibold text-admin-muted">{label}</p>
      <div className="text-[13px] text-admin-ink">{children}</div>
    </div>
  )
}

export default async function AdminCustomerDetail({ params }: Props) {
  const { locale, id } = await params
  await requireAdminPage(locale)
  const c = await getCustomer(id)
  if (!c) notFound()
  const list = `/${locale}/admin/customers`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={list} aria-label="Kembali ke daftar pelanggan" className="inline-flex size-9 items-center justify-center rounded-xl border border-admin-line bg-white text-admin-muted hover:text-admin-ink"><ArrowLeft className="size-4" /></Link>
        <div>
          <h1 className="m-0 text-xl font-extrabold tracking-tight">{c.deleted ? 'Akun dihapus' : c.fullName}</h1>
          <p className="m-0 text-xs text-admin-muted">Terdaftar {dt(c.createdAt)}</p>
        </div>
        <Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
      </div>

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

      <Card className="space-y-3 p-5">
        <h2 className="m-0 text-sm font-bold text-admin-ink">Pesanan</h2>
        {c.bookings.length === 0 ? <p className="m-0 text-sm text-admin-muted">Belum pernah memesan.</p> : (
          <ul className="m-0 list-none divide-y divide-admin-line p-0">
            {c.bookings.map(b => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Link href={`/${locale}/admin/bookings/${b.id}`} className="font-mono text-[12px] font-semibold text-admin-accent hover:text-admin-accent-strong">{b.bookingCode}</Link>
                  <p className="m-0 text-[11px] text-admin-muted">Dipesan {dt(b.createdAt)} · berangkat {dt(b.departureDate)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12px] font-medium tabular-nums">{formatRupiah(b.totalAmount)}</span>
                  <Badge tone={BOOKING_TONE[b.status] ?? 'neutral'}>{BOOKING_STATUS[b.status as keyof typeof BOOKING_STATUS]?.label ?? b.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
