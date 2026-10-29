'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Plus, Trash2, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { VendorPicker } from '@/components/admin/vendor/VendorPicker'
import { PriceCard } from '@/components/admin/pricing/PriceCard'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

const CURRENCIES = ['IDR', 'SAR', 'USD', 'EUR']

type VehicleInfo = { id: string; name: string; vehicleType: string; capacity: number }
type Pricing = { id: string; vehicleId: string; price: number; isActive: boolean; vehicle: VehicleInfo }
type Trip = {
  id: string; name: string; category: string | null; description: string | null
  origin: string; destination: string; isActive: boolean
  pricing: Pricing[]
}

type Props = { params: Promise<{ locale: string; id: string }> }

const CATEGORIES = ['airport', 'intercity', 'city_tour', 'shuttle', 'other']

function PricingRow({ pricing, onChanged }: {
  pricing: Pricing
  onChanged: () => void
}) {
  const [vendorId, setVendorId]   = useState('')
  const [currency, setCurrency]   = useState('IDR')
  const [hargaKendaraan, setHargaKendaraan] = useState('')
  const [preview, setPreview]     = useState<{ hppRupiah: number; sellPrice: number } | null>(null)
  const [loaded, setLoaded]       = useState(false)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/v1/admin/products/transport/pricing/${pricing.id}/cost`)
      .then(r => r.json())
      .then(j => {
        if (j.data) {
          setVendorId(j.data.vendorId ?? '')
          setCurrency(j.data.currency ?? 'IDR')
          setHargaKendaraan(j.data.hargaKendaraan ? String(j.data.hargaKendaraan) : '')
        }
        setLoaded(true)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing.id])

  useEffect(() => {
    if (!loaded) return
    const cost = Number(hargaKendaraan)
    if (!cost || cost <= 0) { setPreview(null); return }
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ hargaKendaraan: String(cost), currency })
      const r = await fetch(`/api/v1/admin/products/transport/simulate?${params}`)
      const j = await r.json()
      setPreview(j.data ? { hppRupiah: j.data.hppRupiah, sellPrice: j.data.sellPrice } : null)
    }, 500)
    return () => clearTimeout(timer)
  }, [hargaKendaraan, currency, loaded])

  const canSave = !!vendorId && Number(hargaKendaraan) > 0

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    const r = await fetch(`/api/v1/admin/products/transport/pricing/${pricing.id}/cost`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorId, currency, hargaKendaraan: Number(hargaKendaraan) }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => null)
      setSaveError(j?.error ?? 'Harga kendaraan gagal disimpan.')
      setSaving(false)
      return
    }
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onChanged()
  }

  async function handleDelete() {
    setDeleting(true)
    await fetch(`/api/v1/admin/products/transport/pricing/${pricing.id}`, { method: 'DELETE' })
    onChanged()
  }

  return (
    <div className="border border-admin-line rounded-xl p-4 space-y-3 bg-admin-spot/30">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-admin-ink capitalize">{pricing.vehicle.name}</p>
          <p className="text-[11px] text-admin-muted">{pricing.vehicle.capacity} kursi · {pricing.vehicle.vehicleType}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] text-admin-muted/70">Harga saat ini</p>
            <p className="text-sm font-bold text-admin-ink">{formatRupiah(pricing.price)}</p>
          </div>
          <button onClick={handleDelete} disabled={deleting}
            className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="border border-admin-line rounded-lg p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <VendorPicker value={vendorId} onChange={setVendorId} context="transport" label="Vendor transport" />
          </div>
          <select className="admin-inp w-20 shrink-0 text-sm" value={currency} onChange={e => setCurrency(e.target.value)}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-2 items-end">
        <div>
          <p className="text-[11px] text-admin-muted mb-1">Harga Kendaraan ({currency})</p>
          <input type="number" className="admin-inp text-sm" value={hargaKendaraan}
            onChange={e => setHargaKendaraan(e.target.value)} placeholder="0" />
        </div>
        <div>
          <p className="text-[11px] text-admin-muted mb-1">HPP (Rupiah)</p>
          <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink text-sm">{preview ? formatRupiah(Math.round(preview.hppRupiah)) : '—'}</p>
        </div>
        <div>
          <p className="text-[11px] text-admin-muted mb-1">Harga Jual (otomatis)</p>
          <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink text-sm">{preview ? formatRupiah(preview.sellPrice) : '—'}</p>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving || !canSave}
        className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
        <Save className="h-3.5 w-3.5" />
        {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan Harga'}
      </button>
      {saveError && <p role="alert" className="text-[12px] font-medium text-admin-danger">{saveError}</p>}

      <PriceCard ownerType="transport" ownerId={pricing.id} title={`Harga ${pricing.vehicle.name}: modal, jual, untung`} reloadKey={`${pricing.price}-${saved}`} onChanged={onChanged} />
    </div>
  )
}

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
  const [addVehicleId,  setAddVehicleId]  = useState('')
  const [addingPricing, setAddingPricing] = useState(false)

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

  async function handleAddPricing() {
    if (!addVehicleId) return
    setAddingPricing(true)
    await fetch('/api/v1/admin/products/transport/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripId: id, vehicleId: addVehicleId }),
    })
    setAddVehicleId('')
    await load(id)
    setAddingPricing(false)
  }

  async function handleDeleteTrip() {
    if (!(await ask({ title: `Hapus trip "${trip?.name}"?`, body: 'Semua harga kendaraan yang terkait juga akan dihapus. Trip yang sudah dipakai booking dinonaktifkan, bukan dihapus.' }))) return
    await fetch(`/api/v1/admin/products/transport/trips/${id}`, { method: 'DELETE' })
    router.push(`/${locale}/admin/products/transport`)
  }

  // Vehicles not yet added to this trip
  const usedVehicleIds = new Set(trip?.pricing.map(p => p.vehicleId) ?? [])
  const availableVehicles = allVehicles.filter(v => !usedVehicleIds.has(v.id))

  if (!trip) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      {dialog}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/${locale}/admin/products/transport`)}
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

      {/* Pricing per kendaraan */}
      <div className="admin-form-panel space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-4 w-4" /> Harga per Kendaraan</p>
            <p className="text-[11px] text-admin-muted/70 mt-0.5">
              Satu harga flat per kombinasi rute×kendaraan, dihitung dari HPP — docs/arsitektur-transportasi.md §9
            </p>
          </div>
          {availableVehicles.length > 0 && (
            <div className="flex items-center gap-2">
              <ChoiceSelect className="min-w-0 flex-1" placeholder="— pilih kendaraan —" value={addVehicleId} onChange={setAddVehicleId}
                options={availableVehicles.map(v => ({ id: v.id, label: v.name, hint: `${v.capacity} org` }))} />
              <button onClick={handleAddPricing} disabled={!addVehicleId || addingPricing}
                className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {addingPricing ? 'Menambah...' : 'Tambah'}
              </button>
            </div>
          )}
        </div>

        {trip.pricing.length === 0 && (
          <p className="text-[13px] text-admin-muted/70 py-4 text-center border border-dashed border-admin-line rounded-xl">
            Belum ada kendaraan. Pilih kendaraan di atas untuk menambahkan harga.
          </p>
        )}

        <div className="space-y-4">
          {trip.pricing.map((pricing) => (
            <PricingRow
              key={pricing.id}
              pricing={pricing}
              onChanged={() => load(id)}
            />
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div className="admin-form-panel border-admin-danger/20 space-y-3">
        <p className="text-sm font-semibold text-admin-danger">Zona Berbahaya</p>
        <p className="text-[12px] text-admin-muted">Hapus trip dan semua pricing yang terkait secara permanen.</p>
        <button onClick={handleDeleteTrip}
          className="px-4 py-2 rounded-xl border border-admin-danger/30 text-[13px] font-medium text-admin-danger hover:bg-admin-danger/10 transition-colors">
          Hapus Trip
        </button>
      </div>
    </div>
  )
}
