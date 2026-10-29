'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Bus } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

const TYPES = ['bus', 'coaster', 'hiace', 'staria', 'gmc', 'innova', 'sedan']

export default function NewVehiclePage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/products/transport/vehicles', id => `/${locale}/admin/products/transport/vehicles/${id}`, 'Kendaraan gagal dibuat.')
  const [form, setForm] = useState({ name: '', vehicleType: 'bus', capacity: 49, fleetCount: 1 })

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }

  return (
    <CreatePage
      icon={Bus} title="Kendaraan Baru" backHref={`/${locale}/admin/products/transport`} backLabel="Daftar Transport"
      description="Harga tidak diatur di sini — diatur di halaman Trip per kombinasi trip + kendaraan."
      onSubmit={() => submit({ ...form, capacity: +form.capacity, fleetCount: +form.fleetCount })}
      saving={saving} canSubmit={!!form.name.trim()} error={error} submitLabel="Simpan & Lanjut"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div><p className="mb-1 text-xs text-admin-muted">Nama</p><input className="admin-inp" autoFocus value={form.name} onChange={set('name')} placeholder="Bus Pariwisata 49" /></div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Tipe</p>
          <ChoiceSelect value={form.vehicleType} onChange={v => setForm(f => ({ ...f, vehicleType: v }))} clearable={false} options={TYPES.map(t => ({ id: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} />
        </div>
        <div><p className="mb-1 text-xs text-admin-muted">Kapasitas (orang)</p><input type="number" min={1} className="admin-inp" value={form.capacity} onChange={set('capacity')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Jumlah Armada (unit)</p><input type="number" min={1} className="admin-inp" value={form.fleetCount} onChange={set('fleetCount')} /></div>
      </div>
    </CreatePage>
  )
}
