'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save } from 'lucide-react'
import { ProductMediaGallery } from '@/components/admin/media/ProductMediaGallery'

const TYPES = ['bus', 'coaster', 'hiace', 'staria', 'gmc', 'innova', 'sedan']

type Vehicle = {
  id: string; name: string; vehicleType: string; capacity: number
  fleetCount: number; description: string | null; isActive: boolean
}

type Props = { params: Promise<{ locale: string; id: string }> }

export default function VehicleEditPage({ params }: Props) {
  const router = useRouter()
  const [id, setId]         = useState('')
  const [locale, setLocale] = useState('id')
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [form, setForm] = useState({
    name: '', vehicleType: 'bus', capacity: 49, description: '', fleetCount: 1, isActive: true,
  })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id); setLocale(p.locale)
      const r = await fetch(`/api/v1/admin/products/transport/vehicles/${p.id}`)
      const j = await r.json()
      if (j.data) {
        const v: Vehicle = j.data
        setVehicle(v)
        setForm({
          name: v.name, vehicleType: v.vehicleType, capacity: v.capacity,
          description: v.description ?? '', fleetCount: v.fleetCount, isActive: v.isActive,
        })
      }
    })
  }, [params])

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true)
    await fetch(`/api/v1/admin/products/transport/vehicles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, capacity: +form.capacity, fleetCount: +form.fleetCount }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!vehicle) return <div className="text-sm text-slate-400 p-6">Memuat...</div>

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/${locale}/admin/products/transport`)}
          className="text-slate-400 hover:text-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1">Edit Kendaraan</h1>
      </div>

      <ProductMediaGallery
        hotelId={id}
        apiBase={`/api/v1/admin/products/transport/vehicles/${id}/images`}
        label="Foto Kendaraan"
      />

      <div className="admin-form-panel space-y-4">
        <p className="text-sm font-semibold text-ink">Informasi Kendaraan</p>
        <p className="text-[11px] text-slate-400">
          Harga diatur di halaman <strong>Trip</strong> — setiap trip punya harga berbeda per kendaraan.
        </p>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-500 mb-1">Nama Kendaraan</p>
            <input className="admin-inp" value={form.name} onChange={set('name')} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Tipe</p>
            <select className="admin-select" value={form.vehicleType} onChange={set('vehicleType')}>
              {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Kapasitas (orang)</p>
            <input type="number" min={1} className="admin-inp" value={form.capacity} onChange={set('capacity')} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Jumlah Armada (unit)</p>
            <input type="number" min={1} className="admin-inp" value={form.fleetCount} onChange={set('fleetCount')} />
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-slate-500 mb-1">Deskripsi (opsional)</p>
            <textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit pt-1">
          <div
            onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-teal-600' : 'bg-slate-200'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-ink">Aktif (tampil di catalog)</span>
        </label>

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  )
}
