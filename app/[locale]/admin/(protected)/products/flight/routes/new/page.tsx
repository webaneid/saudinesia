'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'

export default function NewFlightRoutePage() {
  const { locale } = useParams() as { locale: string }
  // Rute belum punya halaman edit (gap tercatat di docs/arsitektur-admin-create.md §5) — setelah dibuat kembali ke daftar Tiket Pesawat.
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/flight/routes', () => `/${locale}/admin/products/flight`, 'Rute gagal dibuat.')
  const [form, setForm] = useState({ origin: '', destination: '' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={MapPin} title="Rute Penerbangan Baru" backHref={`/${locale}/admin/products/flight`} backLabel="Daftar Tiket Pesawat"
      description="Rute dipakai oleh jadwal penerbangan."
      onSubmit={() => submit(form)} saving={saving} canSubmit={!!form.origin.trim() && !!form.destination.trim()} error={error}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="mb-1 text-xs text-admin-muted">Asal</p><input className="admin-inp" autoFocus value={form.origin} onChange={set('origin')} placeholder="Cengkareng (CGK)" /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tujuan</p><input className="admin-inp" value={form.destination} onChange={set('destination')} placeholder="Madinah (MED)" /></div>
      </div>
    </CreatePage>
  )
}
