'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save } from 'lucide-react'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { TransportQuotaPanel } from './TransportQuotaPanel'
import { TransportPricingTable, type TripPricing } from './TransportPricingTable'
import { adminHref } from '@/lib/admin/href'

type VehicleInfo = { id: string; name: string; vehicleType: string; capacity: number }
type Trip = {
  id: string; name: string; category: string | null; description: string | null
  origin: string; destination: string; isActive: boolean
  pricing: TripPricing[]
}

type Props = { params: Promise<{ locale: string; id: string }> }

const CATEGORIES = ['airport', 'intercity', 'city_tour', 'shuttle', 'other']

export default function TripEditPage({ params }: Props) {
  const { ask, dialog } = useConfirm()
  const router = useRouter()
  const [id, setId]         = useState('')
  const [locale, setLocale] = useState('id')
  const [trip, setTrip]     = useState<Trip | null>(null)
  const [allVehicles, setAllVehicles] = useState<VehicleInfo[]>([])
  const [form, setForm] = useState({
    name: '', category: '', description: '', origin: '', destination: '', isActive: true,
  })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null)

  async function load(tripId: string) {
    const r = await fetch(`/api/v1/admin/products/transport/trips/${tripId}`)
    const j = await r.json()
    if (j.data) {
      const t: Trip = j.data
      setTrip(t)
      setForm({
        name: t.name, category: t.category ?? '', description: t.description ?? '',
        origin: t.origin, destination: t.destination, isActive: t.isActive,
      })
    }
  }

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id); setLocale(p.locale)
      await load(p.id)
      const r = await fetch('/api/v1/admin/products/transport/vehicles')
      const j = await r.json()
      setAllVehicles(j.data ?? [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  function setField(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleSaveTrip() {
    setSaving(true)
    await fetch(`/api/v1/admin/products/transport/trips/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        category:    form.category || null,
        description: form.description || null,
      }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleDeleteTrip() {
    if (!(await ask({ title: `Hapus trip "${trip?.name}"?`, body: 'Semua harga kendaraan yang terkait juga akan dihapus. Trip yang sudah dipakai booking dinonaktifkan, bukan dihapus.' }))) return
    setDeleteNotice(null)
    const j = await fetch(`/api/v1/admin/products/transport/trips/${id}`, { method: 'DELETE' }).then(r => r.json()).catch(() => null)
    if (!j?.success) { setDeleteNotice(j?.error ?? 'Gagal menghapus trip'); return }
    if (j.data?.deleted) { router.push(adminHref(locale, `/admin/products/transport`)); return }
    setDeleteNotice(j.data?.message ?? 'Trip dinonaktifkan')
    void load(id)
  }

  if (!trip) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      {dialog}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(adminHref(locale, `/admin/products/transport`))}
          className="text-admin-muted/70 hover:text-admin-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1">Edit Trip</h1>
      </div>

      {/* Trip info */}
      <div className="admin-form-panel space-y-4">
        <p className="text-sm font-semibold text-admin-ink">Informasi Trip</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <p className="text-xs text-admin-muted mb-1">Nama Trip</p>
            <input className="admin-inp" value={form.name} onChange={setField('name')} placeholder="Airport Transfer — Bandara ke Hotel" />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Kategori</p>
            <input className="admin-inp" value={form.category} onChange={setField('category')}
              list="category-suggestions" placeholder="airport / intercity / city_tour / …" />
            <datalist id="category-suggestions">
              {CATEGORIES.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Deskripsi (opsional)</p>
            <input className="admin-inp" value={form.description} onChange={setField('description')} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Origin (titik jemput)</p>
            <input className="admin-inp" value={form.origin} onChange={setField('origin')}
              placeholder="Bandara King Abdulaziz Jeddah" />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Destination (titik tujuan)</p>
            <input className="admin-inp" value={form.destination} onChange={setField('destination')}
              placeholder="Hotel Makkah/Madinah" />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <div onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-admin-ink">Aktif (tampil di catalog)</span>
        </label>

        <div className="flex gap-2">
          <button onClick={handleSaveTrip} disabled={saving || !form.name || !form.origin || !form.destination}
            className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
          </button>
        </div>
      </div>

      <TransportPricingTable tripId={trip.id} pricing={trip.pricing} vehicles={allVehicles} onChanged={() => load(id)} />

      <TransportQuotaPanel tripId={trip.id} pricing={trip.pricing} />

      {/* Danger zone */}
      <div className="admin-form-panel border-admin-danger/20 space-y-3">
        <p className="text-sm font-semibold text-admin-danger">Zona Berbahaya</p>
        <p className="text-[12px] text-admin-muted">Hapus trip beserta harga dan kuota tanggalnya. Bila sudah dipakai booking atau paket, trip dinonaktifkan, bukan dihapus.</p>
        {deleteNotice && <p role="status" className="text-[12px] text-admin-danger">{deleteNotice}</p>}
        <button onClick={handleDeleteTrip}
          className="px-4 py-2 rounded-xl border border-admin-danger/30 text-[13px] font-medium text-admin-danger hover:bg-admin-danger/10 transition-colors">
          Hapus Trip
        </button>
      </div>
    </div>
  )
}
