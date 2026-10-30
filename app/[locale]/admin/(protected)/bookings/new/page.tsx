'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { CalendarPlus, Check, UserPlus } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'

// Booking baru oleh admin (docs/arsitektur-booking-engine-v2.md §10.3, D3): pilih pelanggan → draf dibuat → editor draf. Pelanggan baru dibuat di halaman
// Tambah Pelanggan, lalu "Buat booking" dari detail pelanggan itu.
type Customer = { id: string; fullName: string; email: string }

export default function NewBookingPage() {
  const { locale } = useParams<{ locale: string }>()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [picked, setPicked] = useState<Customer | null>(null)
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/bookings/drafts', id => `/${locale}/admin/bookings/drafts/${id}`, 'Draf booking gagal dibuat.')

  useEffect(() => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/v1/admin/customers?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(r => r.json()).then(j => setResults(Array.isArray(j.data) ? j.data : [])).catch(() => {})
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [q])

  return (
    <CreatePage
      icon={CalendarPlus} title="Booking Baru" backHref={`/${locale}/admin/bookings`} backLabel="Daftar Booking"
      description="Pilih pelanggan pemesan. Draf tersimpan otomatis di sistem — produk, jamaah, dan jatuh tempo diatur di halaman berikutnya sebelum diterbitkan."
      onSubmit={() => (picked ? submit({ customerId: picked.id }) : undefined)} saving={saving} canSubmit={!!picked} error={error} submitLabel="Buat draf booking"
    >
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs text-admin-muted">Cari pelanggan (nama, email, atau nomor HP)</p>
          <input className="admin-inp" autoFocus value={q} onChange={e => { clearError(); setQ(e.target.value) }} placeholder="mis. Ahmad atau 0812…" />
        </div>
        <ul className="m-0 list-none space-y-1.5 p-0" aria-label="Hasil pencarian pelanggan">
          {results.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => { clearError(); setPicked(c) }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm ${picked?.id === c.id ? 'border-admin-accent bg-admin-accent/10' : 'border-admin-line hover:bg-admin-spot/60'}`}>
                <span><span className="font-semibold text-admin-ink">{c.fullName}</span> <span className="text-xs text-admin-muted">{c.email}</span></span>
                {picked?.id === c.id && <Check className="size-4 text-admin-accent" aria-label="Terpilih" />}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="text-sm text-admin-muted">Tidak ada pelanggan yang cocok.</li>}
        </ul>
        <Link href={`/${locale}/admin/customers/new`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-admin-accent-strong">
          <UserPlus className="size-4" /> Tambah pelanggan baru
        </Link>
      </div>
    </CreatePage>
  )
}
