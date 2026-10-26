'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Route } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'

const CATS = ['airport', 'intercity', 'city_tour', 'shuttle', 'other']

export default function NewTripPage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/transport/trips', id => `/${locale}/admin/products/transport/trips/${id}`, 'Trip gagal dibuat.')
  const [form, setForm] = useState({ name: '', category: '', origin: '', destination: '' })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={Route} title="Trip Baru" backHref={`/${locale}/admin/products/transport`} backLabel="Daftar Transport"
      description="Setelah disimpan, Anda diarahkan ke halaman trip untuk mengatur harga per kendaraan."
      onSubmit={() => submit({ ...form, category: form.category || null })}
      saving={saving} canSubmit={!!form.name.trim() && !!form.origin.trim() && !!form.destination.trim()} error={error} submitLabel="Simpan & Atur Harga"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><p className="mb-1 text-xs text-admin-muted">Nama Trip</p><input className="admin-inp" autoFocus value={form.name} onChange={set('name')} placeholder="Airport Transfer — Bandara ke Hotel" /></div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Kategori (opsional)</p>
          <input className="admin-inp" value={form.category} onChange={set('category')} list="cat-list" placeholder="airport / intercity / city_tour" />
          <datalist id="cat-list">{CATS.map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <div><p className="mb-1 text-xs text-admin-muted">Origin (titik jemput)</p><input className="admin-inp" value={form.origin} onChange={set('origin')} placeholder="Bandara King Abdulaziz Jeddah" /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Destination (titik tujuan)</p><input className="admin-inp" value={form.destination} onChange={set('destination')} placeholder="Hotel Makkah/Madinah" /></div>
      </div>
    </CreatePage>
  )
}
