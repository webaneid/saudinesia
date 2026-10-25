'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Plus, Pencil, Trash2, MapPin, Landmark, Building2, Wallet, Bus } from 'lucide-react'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { vendorQuickAddError } from '@/lib/admin/vendorQuickAdd'

const CURRENCIES = ['IDR', 'SAR', 'USD', 'EUR']
type Mode = 'included' | 'user_choice' | 'none'

const MODE_LABEL: Record<Mode, string> = {
  included: 'Sudah Termasuk (Included)',
  user_choice: 'Pilih Sendiri saat Booking (User Choice)',
  none: 'Tidak Dipakai (None)',
}

type TripPricing = { id: string; price: string; vehicle: { name: string } }
type Trip = { id: string; name: string; category: string | null; origin: string; destination: string; isActive: boolean; pricing: TripPricing[] }
type TourismSite = { id: string; name: string; city: string | null; isActive: boolean }
type Vendor = { id: string; name: string }
type HotelScheduleOption = { id: string; hotelName: string; city: string; roomTypeName: string; price: number }
type PackageHotelRow = {
  id: string; nights: number; numRooms: number; pricePerNight: string
  hotelRoomSchedule: { period: { hotel: { name: string } }; roomType: { name: string } }
}
type PackageHotelOptionRow = {
  id: string; hotelRoomScheduleId: string; nights: number
  hotelRoomSchedule: { period: { hotel: { name: string } }; roomType: { name: string } }
}
type PackageDetail = {
  id: string; name: string; description: string | null; isActive: boolean
  transportMode: Mode; transportTripId: string | null
  includedTransportPricingId: string | null; includedTransportPrice: string | null
  transportTrip: { name: string; origin: string; destination: string; pricing: TripPricing[] } | null
  includedTransportPricing: { vehicle: { name: string } } | null
  hotelMode: Mode
  sites: { tourismSiteId: string; order: number; tourismSite: TourismSite }[]
  hotels: PackageHotelRow[]
  hotelOptions: PackageHotelOptionRow[]
}
type CostRow = { id: string; costComponent: string; vendorId: string; vendorName: string; currency: string; cost: number; hppRupiah: number | null; sellPrice: number | null }
type CostPreview = { hppRupiah: number; sellPrice: number }
type Breakdown = {
  components: { costComponent: string; vendorId: string; currency: string; hppRupiah: number; sellPrice: number }[]
  componentsTotalSellPrice: number
  transportMode: Mode
  includedTransportPrice: number | null
  includedVehicleName: string | null
  vehicleOptions: { transportPricingId: string; vehicleName: string; vehiclePrice: number }[]
  hotelMode: Mode
  hotels: { id: string; hotelName: string; roomTypeName: string; nights: number; numRooms: number; pricePerNight: number; totalPrice: number }[]
  hotelsTotalPrice: number
  hotelOptions: { hotelRoomScheduleId: string; hotelName: string; roomTypeName: string; nights: number; pricePerNight: number }[]
}

type Props = { params: Promise<{ locale: string; id: string }> }

function rupiah(n: number) {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`
}

function ModeSelector({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(['included', 'user_choice', 'none'] as Mode[]).map(m => (
        <button key={m} type="button" onClick={() => onChange(m)}
          className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
            value === m ? 'bg-admin-accent border-admin-accent text-white' : 'border-admin-line text-admin-muted hover:bg-admin-spot'
          }`}>
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  )
}

export default function TourPackageBuilderPage({ params }: Props) {
  const router = useRouter()
  const [id, setId] = useState('')
  const [locale, setLocale] = useState('id')
  const [loaded, setLoaded] = useState(false)

  const [pkg, setPkg] = useState<PackageDetail | null>(null)
  const [form, setForm] = useState({ name: '', description: '', isActive: true })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [allTrips, setAllTrips] = useState<Trip[]>([])
  const [allSites, setAllSites] = useState<TourismSite[]>([])
  const [addSiteId, setAddSiteId] = useState('')
  const [savingSite, setSavingSite] = useState(false)

  // Kendaraan — mode + pilihan (§12)
  const [savingTransportMode, setSavingTransportMode] = useState(false)
  const [includedPricingChoice, setIncludedPricingChoice] = useState('') // "tripId::pricingId"
  const [userChoiceTripId, setUserChoiceTripId] = useState('')

  const [allHotelSchedules, setAllHotelSchedules] = useState<HotelScheduleOption[]>([])
  const [addHotelScheduleId, setAddHotelScheduleId] = useState('')
  const [addHotelNights, setAddHotelNights] = useState('1')
  const [addHotelRooms, setAddHotelRooms] = useState('1')
  const [savingHotel, setSavingHotel] = useState(false)
  const [editingHotelId, setEditingHotelId] = useState<string | null>(null)
  const [editHotelForm, setEditHotelForm] = useState({ nights: '1', numRooms: '1', pricePerNight: '0' })
  const [savingHotelEdit, setSavingHotelEdit] = useState(false)
  const [savingHotelMode, setSavingHotelMode] = useState(false)

  // Hotel opsi (mode user_choice)
  const [addHotelOptionScheduleId, setAddHotelOptionScheduleId] = useState('')
  const [addHotelOptionNights, setAddHotelOptionNights] = useState('1')
  const [savingHotelOption, setSavingHotelOption] = useState(false)

  const [costs, setCosts] = useState<CostRow[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)

  const [showCostForm, setShowCostForm] = useState(false)
  const [editingCostId, setEditingCostId] = useState<string | null>(null)
  const [costForm, setCostForm] = useState({ costComponent: '', vendorId: '', currency: 'IDR', cost: '' })
  const [savingCost, setSavingCost] = useState(false)
  const [showQuickAddVendor, setShowQuickAddVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')
  const [savingVendor, setSavingVendor] = useState(false)
  const [vendorError, setVendorError] = useState<string | null>(null)
  const [costPreview, setCostPreview] = useState<CostPreview | null>(null)

  const loadPackage = useCallback(async (pkgId: string) => {
    const r = await fetch(`/api/v1/admin/products/tour-packages/${pkgId}`)
    const j = await r.json()
    if (j.data) {
      const p: PackageDetail = j.data
      setPkg(p)
      setForm({ name: p.name, description: p.description ?? '', isActive: p.isActive })
      setIncludedPricingChoice(p.transportTripId && p.includedTransportPricingId ? `${p.transportTripId}::${p.includedTransportPricingId}` : '')
      setUserChoiceTripId(p.transportMode === 'user_choice' ? (p.transportTripId ?? '') : '')
    }
  }, [])

  const loadCosts = useCallback(async (pkgId: string) => {
    const r = await fetch(`/api/v1/admin/products/tour-packages/${pkgId}/costs`)
    const j = await r.json()
    setCosts(j.data ?? [])
  }, [])

  const loadBreakdown = useCallback(async (pkgId: string) => {
    const r = await fetch(`/api/v1/admin/products/tour-packages/${pkgId}/breakdown`)
    const j = await r.json()
    setBreakdown(j.data ?? null)
  }, [])

  // Live preview HPP/Harga Jual — debounce 500ms, pola sama docs/arsitektur-tiket-pesawat.md §4.
  useEffect(() => {
    const cost = Number(costForm.cost)
    if (!cost || cost <= 0) { setCostPreview(null); return }
    const timer = setTimeout(async () => {
      const p = new URLSearchParams({ cost: String(cost), currency: costForm.currency })
      const r = await fetch(`/api/v1/admin/products/tour-packages/simulate?${p}`)
      const j = await r.json()
      setCostPreview(j.data ? { hppRupiah: j.data.hppRupiah, sellPrice: j.data.sellPrice } : null)
    }, 500)
    return () => clearTimeout(timer)
  }, [costForm.cost, costForm.currency])

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id); setLocale(p.locale)
      const [, tripsRes, sitesRes, vendorsRes, hotelSchedulesRes] = await Promise.all([
        loadPackage(p.id),
        fetch('/api/v1/admin/products/transport/trips').then(r => r.json()),
        fetch('/api/v1/admin/products/tourism-sites').then(r => r.json()),
        fetch('/api/v1/admin/system/settings/vendors?category=tour_package').then(r => r.json()),
        fetch('/api/v1/admin/products/hotels/schedules').then(r => r.json()),
      ])
      setAllTrips(tripsRes.data ?? [])
      setAllSites(sitesRes.data ?? [])
      setVendors(vendorsRes.data ?? [])
      setAllHotelSchedules(hotelSchedulesRes.data ?? [])
      await Promise.all([loadCosts(p.id), loadBreakdown(p.id)])
      setLoaded(true)
    })
  }, [params, loadPackage, loadCosts, loadBreakdown])

  async function refreshAll() {
    await Promise.all([loadPackage(id), loadCosts(id), loadBreakdown(id)])
  }

  async function handleSaveInfo() {
    setSaving(true)
    await fetch(`/api/v1/admin/products/tour-packages/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, description: form.description || null, isActive: form.isActive }),
    })
    await refreshAll()
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleSetTransportMode(mode: Mode) {
    setSavingTransportMode(true)
    const body: Record<string, unknown> = { transportMode: mode }
    if (mode !== 'included') body.includedTransportPricingId = null
    if (mode !== 'user_choice') body.transportTripId = null
    await fetch(`/api/v1/admin/products/tour-packages/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    await refreshAll()
    setSavingTransportMode(false)
  }

  async function handleSetIncludedPricing(value: string) {
    setIncludedPricingChoice(value)
    if (!value) return
    const [tripId, pricingId] = value.split('::')
    setSavingTransportMode(true)
    await fetch(`/api/v1/admin/products/tour-packages/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transportTripId: tripId, includedTransportPricingId: pricingId }),
    })
    await refreshAll()
    setSavingTransportMode(false)
  }

  async function handleSetUserChoiceTrip(tripId: string) {
    setUserChoiceTripId(tripId)
    setSavingTransportMode(true)
    await fetch(`/api/v1/admin/products/tour-packages/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transportTripId: tripId || null }),
    })
    await refreshAll()
    setSavingTransportMode(false)
  }

  async function handleSetHotelMode(mode: Mode) {
    setSavingHotelMode(true)
    await fetch(`/api/v1/admin/products/tour-packages/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hotelMode: mode }),
    })
    await refreshAll()
    setSavingHotelMode(false)
  }

  async function handleAddSite() {
    if (!addSiteId) return
    setSavingSite(true)
    const order = (pkg?.sites.length ?? 0)
    await fetch(`/api/v1/admin/products/tour-packages/${id}/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tourismSiteId: addSiteId, order }),
    })
    await loadPackage(id)
    setAddSiteId(''); setSavingSite(false)
  }

  async function handleRemoveSite(tourismSiteId: string) {
    await fetch(`/api/v1/admin/products/tour-packages/${id}/sites`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tourismSiteId }),
    })
    await loadPackage(id)
  }

  async function handleAddHotel() {
    if (!addHotelScheduleId) return
    setSavingHotel(true)
    await fetch(`/api/v1/admin/products/tour-packages/${id}/hotels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotelRoomScheduleId: addHotelScheduleId, nights: Number(addHotelNights), numRooms: Number(addHotelRooms) }),
    })
    await Promise.all([loadPackage(id), loadBreakdown(id)])
    setAddHotelScheduleId(''); setAddHotelNights('1'); setAddHotelRooms('1'); setSavingHotel(false)
  }

  async function handleRemoveHotel(hotelRowId: string) {
    await fetch(`/api/v1/admin/products/tour-packages/${id}/hotels/${hotelRowId}`, { method: 'DELETE' })
    await Promise.all([loadPackage(id), loadBreakdown(id)])
  }

  function openEditHotel(h: PackageHotelRow) {
    setEditingHotelId(h.id)
    setEditHotelForm({ nights: String(h.nights), numRooms: String(h.numRooms), pricePerNight: String(Number(h.pricePerNight)) })
  }

  async function handleSaveHotelEdit() {
    if (!editingHotelId) return
    setSavingHotelEdit(true)
    await fetch(`/api/v1/admin/products/tour-packages/${id}/hotels/${editingHotelId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nights: Number(editHotelForm.nights), numRooms: Number(editHotelForm.numRooms), pricePerNight: Number(editHotelForm.pricePerNight),
      }),
    })
    await Promise.all([loadPackage(id), loadBreakdown(id)])
    setSavingHotelEdit(false); setEditingHotelId(null)
  }

  async function handleAddHotelOption() {
    if (!addHotelOptionScheduleId) return
    setSavingHotelOption(true)
    await fetch(`/api/v1/admin/products/tour-packages/${id}/hotel-options`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotelRoomScheduleId: addHotelOptionScheduleId, nights: Number(addHotelOptionNights) }),
    })
    await Promise.all([loadPackage(id), loadBreakdown(id)])
    setAddHotelOptionScheduleId(''); setAddHotelOptionNights('1'); setSavingHotelOption(false)
  }

  async function handleRemoveHotelOption(hotelRoomScheduleId: string) {
    await fetch(`/api/v1/admin/products/tour-packages/${id}/hotel-options`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotelRoomScheduleId }),
    })
    await Promise.all([loadPackage(id), loadBreakdown(id)])
  }

  function openCostForm(c?: CostRow) {
    if (c) {
      setEditingCostId(c.id)
      setCostForm({ costComponent: c.costComponent, vendorId: c.vendorId, currency: c.currency, cost: String(c.cost) })
    } else {
      setEditingCostId(null)
      setCostForm({ costComponent: '', vendorId: '', currency: 'IDR', cost: '' })
    }
    setShowQuickAddVendor(false); setNewVendorName(''); setCostPreview(null)
    setShowCostForm(true)
  }

  async function handleQuickAddVendor() {
    if (!newVendorName.trim()) return
    setSavingVendor(true)
    setVendorError(null)
    const r = await fetch('/api/v1/admin/system/settings/vendors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newVendorName.trim(), category: 'tour_package' }),
    })
    const j = await r.json().catch(() => null)
    setSavingVendor(false)
    if (!j?.data?.id) { setVendorError(vendorQuickAddError(r.status, j?.error)); return }
    setVendors(vs => [...vs, j.data].sort((a, b) => a.name.localeCompare(b.name)))
    setCostForm(f => ({ ...f, vendorId: j.data.id }))
    setNewVendorName(''); setShowQuickAddVendor(false)
  }

  async function handleSaveCost() {
    setSavingCost(true)
    const body = { costComponent: costForm.costComponent, vendorId: costForm.vendorId, currency: costForm.currency, cost: Number(costForm.cost) }
    if (editingCostId) {
      await fetch(`/api/v1/admin/products/tour-packages/${id}/costs/${editingCostId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    } else {
      await fetch(`/api/v1/admin/products/tour-packages/${id}/costs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    }
    await Promise.all([loadCosts(id), loadBreakdown(id), loadPackage(id)])
    setSavingCost(false); setShowCostForm(false)
  }

  async function handleDeleteCost(costId: string) {
    if (!confirm('Hapus komponen biaya ini?')) return
    await fetch(`/api/v1/admin/products/tour-packages/${id}/costs/${costId}`, { method: 'DELETE' })
    await Promise.all([loadCosts(id), loadBreakdown(id), loadPackage(id)])
  }

  if (!loaded || !pkg) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  const availableSites = allSites.filter(s => s.isActive && !pkg.sites.some(ps => ps.tourismSiteId === s.id))
  const availableHotelOptionSchedules = allHotelSchedules.filter(s => !pkg.hotelOptions.some(o => o.hotelRoomScheduleId === s.id))
  const allPricingFlat = allTrips.filter(t => t.isActive).flatMap(t => t.pricing.map(p => ({ tripId: t.id, tripName: t.name, ...p })))

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/${locale}/admin/products/tour-packages`)}
          className="text-admin-muted/70 hover:text-admin-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1 flex items-center gap-2"><Landmark className="h-5 w-5 text-admin-accent" /> {pkg.name}</h1>
      </div>

      {/* Info dasar */}
      <div className="admin-form-panel space-y-3">
        <p className="text-sm font-semibold text-admin-ink">Info Paket</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <p className="text-xs text-admin-muted mb-1">Nama Paket</p>
            <input className="admin-inp" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="md:col-span-2 min-w-0">
            <p className="text-xs text-admin-muted mb-1">Deskripsi</p>
            <RichTextEditor id="tourpackage-description" title="Deskripsi paket ziarah" value={form.description} onChange={description => setForm(f => ({ ...f, description }))} placeholder="Program ziarah, situs yang dikunjungi, dan catatan untuk jamaah…" />
          </div>
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <div onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-admin-ink">Aktif</span>
        </label>
        <button onClick={handleSaveInfo} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
          <Save className="h-3.5 w-3.5" /> {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
        </button>
      </div>

      {/* Situs wisata */}
      <div className="admin-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><MapPin className="h-4 w-4 text-admin-accent" /> Situs Wisata dalam Paket</p>
        </div>
        <div className="space-y-2">
          {pkg.sites.map(s => (
            <div key={s.tourismSiteId} className="flex items-center justify-between rounded-lg border border-admin-line px-4 py-2.5">
              <p className="text-[13px] font-medium text-admin-ink">{s.tourismSite.name}<span className="text-admin-muted/70 font-normal"> — {s.tourismSite.city}</span></p>
              <button onClick={() => handleRemoveSite(s.tourismSiteId)}
                className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {pkg.sites.length === 0 && <p className="text-sm text-admin-muted/70 py-2">Belum ada situs ditambahkan.</p>}
        </div>
        <div className="flex gap-2 pt-1">
          <select className="admin-select flex-1" value={addSiteId} onChange={e => setAddSiteId(e.target.value)}>
            <option value="">— pilih situs untuk ditambahkan —</option>
            {availableSites.map(s => <option key={s.id} value={s.id}>{s.name} ({s.city})</option>)}
          </select>
          <button onClick={handleAddSite} disabled={savingSite || !addSiteId} className="admin-btn-sm disabled:opacity-50 shrink-0 flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" /> Tambah
          </button>
        </div>
      </div>

      {/* Kendaraan — 3 mode (§12) */}
      <div className="admin-card p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Bus className="h-4 w-4 text-admin-accent" /> Kendaraan</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">Pilih bagaimana kendaraan masuk ke paket ini — lihat docs/arsitektur-ziarah.md §12.2</p>
        </div>
        <ModeSelector value={pkg.transportMode} onChange={handleSetTransportMode} />

        {pkg.transportMode === 'included' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-accent-strong bg-admin-accent/10 rounded px-2 py-1 w-fit">Harga kendaraan ini MASUK ke Harga Jual Paket — pilgrim tidak memilih kendaraan saat booking.</p>
            <select className="admin-select" value={includedPricingChoice} onChange={e => handleSetIncludedPricing(e.target.value)} disabled={savingTransportMode}>
              <option value="">— pilih kendaraan —</option>
              {allPricingFlat.map(p => (
                <option key={p.id} value={`${p.tripId}::${p.id}`}>{p.tripName} — {p.vehicle.name} ({rupiah(Number(p.price))})</option>
              ))}
            </select>
            {pkg.includedTransportPricing && pkg.includedTransportPrice != null && (
              <p className="text-[12px] text-admin-muted">Dikunci: <span className="font-medium text-admin-ink">{pkg.includedTransportPricing.vehicle.name}</span> — {rupiah(Number(pkg.includedTransportPrice))} (harga referensi awal, bisa diedit lewat Komponen Biaya kalau perlu penyesuaian)</p>
            )}
          </div>
        )}

        {pkg.transportMode === 'user_choice' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-warning bg-admin-warning/10 rounded px-2 py-1 w-fit">Harga kendaraan TIDAK masuk Harga Jual Paket — pilgrim pilih &amp; bayar sendiri saat booking.</p>
            <select className="admin-select" value={userChoiceTripId} onChange={e => handleSetUserChoiceTrip(e.target.value)} disabled={savingTransportMode}>
              <option value="">— pilih trip sumber opsi kendaraan —</option>
              {allTrips.filter(t => t.isActive).map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.origin} → {t.destination})</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Hotel — 3 mode (§12) */}
      <div className="admin-card p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Building2 className="h-4 w-4 text-admin-accent" /> Hotel</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">Pilih bagaimana hotel masuk ke paket ini — sama konsep dengan Kendaraan (§12.2)</p>
        </div>
        <ModeSelector value={pkg.hotelMode} onChange={handleSetHotelMode} />

        {pkg.hotelMode === 'included' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-accent-strong bg-admin-accent/10 rounded px-2 py-1 w-fit">Harga hotel ini MASUK ke Harga Jual Paket.</p>
            <div className="space-y-2">
              {pkg.hotels.map(h => editingHotelId === h.id ? (
                <div key={h.id} className="admin-form-panel space-y-2">
                  <p className="text-[13px] font-medium text-admin-ink">{h.hotelRoomSchedule.period.hotel.name} — {h.hotelRoomSchedule.roomType.name}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[11px] text-admin-muted mb-0.5">Malam</p>
                      <input className="admin-inp" type="number" min={1} value={editHotelForm.nights} onChange={e => setEditHotelForm(f => ({ ...f, nights: e.target.value }))} />
                    </div>
                    <div>
                      <p className="text-[11px] text-admin-muted mb-0.5">Kamar</p>
                      <input className="admin-inp" type="number" min={1} value={editHotelForm.numRooms} onChange={e => setEditHotelForm(f => ({ ...f, numRooms: e.target.value }))} />
                    </div>
                    <div>
                      <p className="text-[11px] text-admin-muted mb-0.5">Harga/malam (Rp)</p>
                      <input className="admin-inp" type="number" min={0} value={editHotelForm.pricePerNight} onChange={e => setEditHotelForm(f => ({ ...f, pricePerNight: e.target.value }))} />
                    </div>
                  </div>
                  <p className="text-[11px] text-admin-muted/70">Harga di atas cuma referensi awal dari data Hotel — bisa diedit bebas untuk paket ini.</p>
                  <div className="flex gap-2">
                    <button onClick={handleSaveHotelEdit} disabled={savingHotelEdit} className="admin-btn-sm disabled:opacity-50">{savingHotelEdit ? '...' : 'Simpan'}</button>
                    <button onClick={() => setEditingHotelId(null)} className="admin-btn-ghost text-sm">Batal</button>
                  </div>
                </div>
              ) : (
                <div key={h.id} className="flex items-center justify-between rounded-lg border border-admin-line px-4 py-2.5">
                  <div>
                    <p className="text-[13px] font-medium text-admin-ink">{h.hotelRoomSchedule.period.hotel.name} — {h.hotelRoomSchedule.roomType.name}</p>
                    <p className="text-[11px] text-admin-muted">{h.nights} malam × {h.numRooms} kamar × {rupiah(Number(h.pricePerNight))} = {rupiah(h.nights * h.numRooms * Number(h.pricePerNight))}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => openEditHotel(h)} className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-ink hover:bg-admin-spot transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleRemoveHotel(h.id)}
                      className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {pkg.hotels.length === 0 && <p className="text-sm text-admin-muted/70 py-2">Belum ada hotel ditambahkan.</p>}
            </div>
            <div className="grid md:grid-cols-4 gap-2 pt-1">
              <select className="admin-select md:col-span-2" value={addHotelScheduleId} onChange={e => setAddHotelScheduleId(e.target.value)}>
                <option value="">— pilih hotel + tipe kamar —</option>
                {allHotelSchedules.map(s => (
                  <option key={s.id} value={s.id}>{s.hotelName} — {s.roomTypeName} ({s.city}) — {rupiah(s.price)}/mlm</option>
                ))}
              </select>
              <input className="admin-inp" type="number" min={1} placeholder="Malam" value={addHotelNights} onChange={e => setAddHotelNights(e.target.value)} />
              <input className="admin-inp" type="number" min={1} placeholder="Kamar" value={addHotelRooms} onChange={e => setAddHotelRooms(e.target.value)} />
              <button onClick={handleAddHotel} disabled={savingHotel || !addHotelScheduleId} className="admin-btn-sm disabled:opacity-50 shrink-0 flex items-center gap-1 md:col-span-4 w-fit">
                <Plus className="h-3.5 w-3.5" /> Tambah
              </button>
            </div>
          </div>
        )}

        {pkg.hotelMode === 'user_choice' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-warning bg-admin-warning/10 rounded px-2 py-1 w-fit">Harga hotel TIDAK masuk Harga Jual Paket — pilgrim pilih tipe kamar &amp; jumlah kamar sendiri saat booking.</p>
            <div className="space-y-2">
              {pkg.hotelOptions.map(o => (
                <div key={o.id} className="flex items-center justify-between rounded-lg border border-admin-line px-4 py-2.5">
                  <p className="text-[13px] font-medium text-admin-ink">{o.hotelRoomSchedule.period.hotel.name} — {o.hotelRoomSchedule.roomType.name} <span className="text-admin-muted/70 font-normal">({o.nights} malam)</span></p>
                  <button onClick={() => handleRemoveHotelOption(o.hotelRoomScheduleId)}
                    className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {pkg.hotelOptions.length === 0 && <p className="text-sm text-admin-muted/70 py-2">Belum ada opsi hotel ditawarkan.</p>}
            </div>
            <div className="flex gap-2 pt-1">
              <select className="admin-select flex-1" value={addHotelOptionScheduleId} onChange={e => setAddHotelOptionScheduleId(e.target.value)}>
                <option value="">— pilih hotel + tipe kamar untuk ditawarkan —</option>
                {availableHotelOptionSchedules.map(s => (
                  <option key={s.id} value={s.id}>{s.hotelName} — {s.roomTypeName} ({s.city}) — {rupiah(s.price)}/mlm</option>
                ))}
              </select>
              <input className="admin-inp w-24" type="number" min={1} placeholder="Malam" value={addHotelOptionNights} onChange={e => setAddHotelOptionNights(e.target.value)} />
              <button onClick={handleAddHotelOption} disabled={savingHotelOption || !addHotelOptionScheduleId} className="admin-btn-sm disabled:opacity-50 shrink-0 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Tambah
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Komponen biaya */}
      <div className="admin-form-panel space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-4 w-4" /> Komponen Biaya</p>
            <p className="text-[11px] text-admin-muted/70 mt-0.5">
              Tiap komponen (Guide, Makan, Minum, dst) dapat margin sendiri, baru dijumlah ke harga paket — lihat docs/arsitektur-ziarah.md §8.3
            </p>
          </div>
          <button onClick={() => openCostForm()} className="admin-btn-sm flex items-center gap-1 shrink-0"><Plus className="h-3.5 w-3.5" /> Tambah</button>
        </div>

        {showCostForm && (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-admin-muted mb-1">Nama Komponen</p>
              <input className="admin-inp" placeholder="Guide, Makan Siang, Air Mineral, dst"
                value={costForm.costComponent} onChange={e => setCostForm(f => ({ ...f, costComponent: e.target.value }))} />
            </div>

            <div className="border border-admin-line rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-admin-ink">Vendor &amp; Mata Uang</p>
              {vendors.length === 0 && !showQuickAddVendor && (
                <p className="text-[11px] text-admin-warning">Belum ada vendor — tambah dulu.</p>
              )}
              {vendorError && <p role="alert" className="text-[11px] font-medium text-admin-danger">{vendorError}</p>}
              <div className="flex items-center gap-2">
                {!showQuickAddVendor ? (
                  <>
                    <select className="admin-inp flex-1" value={costForm.vendorId} onChange={e => setCostForm(f => ({ ...f, vendorId: e.target.value }))}>
                      <option value="">Pilih vendor…</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setShowQuickAddVendor(true)}
                      className="admin-btn-ghost text-xs shrink-0 flex items-center gap-1">
                      <Plus className="h-3 w-3" /> Vendor Baru
                    </button>
                  </>
                ) : (
                  <>
                    <input autoFocus className="admin-inp flex-1" placeholder="Nama vendor"
                      value={newVendorName} onChange={e => setNewVendorName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleQuickAddVendor() } }} />
                    <button type="button" onClick={handleQuickAddVendor} disabled={savingVendor || !newVendorName.trim()}
                      className="admin-btn-sm text-xs shrink-0 disabled:opacity-50">{savingVendor ? '...' : 'Simpan'}</button>
                    <button type="button" onClick={() => { setShowQuickAddVendor(false); setNewVendorName('') }}
                      className="admin-btn-ghost text-xs shrink-0">Batal</button>
                  </>
                )}
                <select className="admin-inp w-20 shrink-0" value={costForm.currency} onChange={e => setCostForm(f => ({ ...f, currency: e.target.value }))}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-3 items-end">
              <div>
                <p className="text-xs text-admin-muted mb-1">Biaya ({costForm.currency})</p>
                <input className="admin-inp" type="number" placeholder="0"
                  value={costForm.cost} onChange={e => setCostForm(f => ({ ...f, cost: e.target.value }))} />
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">HPP (Rupiah)</p>
                <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink">{costPreview ? rupiah(costPreview.hppRupiah) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">Harga Jual (otomatis)</p>
                <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink">{costPreview ? rupiah(costPreview.sellPrice) : '—'}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={handleSaveCost} disabled={savingCost || !costForm.costComponent || !costForm.vendorId || !costForm.cost}
                className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
                <Save className="h-3.5 w-3.5" /> {savingCost ? 'Menyimpan...' : 'Simpan Komponen'}
              </button>
              <button onClick={() => setShowCostForm(false)} className="admin-btn-ghost text-sm">Batal</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {costs.map(c => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-admin-line px-4 py-2.5">
              <div>
                <p className="text-[13px] font-medium text-admin-ink">{c.costComponent}</p>
                <p className="text-[11px] text-admin-muted">{c.vendorName} · {c.currency} {c.cost.toLocaleString('id-ID')}{c.hppRupiah != null && ` · HPP ${rupiah(c.hppRupiah)}`}</p>
              </div>
              <div className="flex items-center gap-3">
                {c.sellPrice != null && <p className="text-[13px] font-bold text-admin-accent-strong">{rupiah(c.sellPrice)}</p>}
                <div className="flex items-center gap-1.5">
                  <button onClick={() => openCostForm(c)} className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-ink hover:bg-admin-spot transition-colors">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDeleteCost(c.id)} className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {costs.length === 0 && <p className="text-sm text-admin-muted/70 py-2">Belum ada komponen biaya.</p>}
          {costs.length > 0 && breakdown && (
            <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
              <span className="text-[12px] font-semibold text-admin-ink">Total Komponen</span>
              <span className="text-[13px] font-bold text-admin-accent-strong">{rupiah(breakdown.componentsTotalSellPrice)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Preview Harga — 2 blok terpisah (§12.7): dasar (included) vs opsi tambahan (user_choice) */}
      {breakdown && (
        <div className="admin-card p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-admin-ink">Harga Jual Paket (dasar)</p>
            <p className="text-[11px] text-admin-muted/70 mt-0.5">Komponen + kendaraan/hotel yang modenya &quot;Included&quot; saja — ini yang tampil di katalog publik.</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
              <span className="text-[13px] text-admin-ink">Komponen Biaya</span>
              <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.componentsTotalSellPrice)}</span>
            </div>
            {breakdown.transportMode === 'included' && breakdown.includedTransportPrice != null && (
              <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
                <span className="text-[13px] text-admin-ink">Kendaraan — {breakdown.includedVehicleName}</span>
                <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.includedTransportPrice)}</span>
              </div>
            )}
            {breakdown.hotelMode === 'included' && breakdown.hotels.map(h => (
              <div key={h.id} className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
                <span className="text-[13px] text-admin-ink">Hotel — {h.hotelName} ({h.roomTypeName})</span>
                <span className="text-[13px] font-medium text-admin-ink">{rupiah(h.totalPrice)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg px-4 py-2 border-t border-admin-line">
              <span className="text-[13px] font-bold text-admin-ink">Harga Jual Paket</span>
              <span className="text-[15px] font-bold text-admin-accent-strong">
                {rupiah(breakdown.componentsTotalSellPrice + breakdown.hotelsTotalPrice + (breakdown.includedTransportPrice ?? 0))}
              </span>
            </div>
          </div>

          {(breakdown.vehicleOptions.length > 0 || breakdown.hotelOptions.length > 0) && (
            <div>
              <p className="text-sm font-semibold text-admin-ink">Opsi Tambahan (dipilih pilgrim saat booking)</p>
              <p className="text-[11px] text-admin-muted/70 mt-0.5 mb-2">Harga di bawah ini TIDAK dijumlah ke Harga Jual Paket — baru ditambahkan kalau pilgrim benar-benar memilihnya.</p>
              <div className="space-y-1.5">
                {breakdown.vehicleOptions.map(v => (
                  <div key={v.transportPricingId} className="flex items-center justify-between rounded-lg bg-admin-warning/10 px-4 py-2">
                    <span className="text-[13px] text-admin-ink">Kendaraan — {v.vehicleName}</span>
                    <span className="text-[13px] font-medium text-admin-warning">+{rupiah(v.vehiclePrice)}</span>
                  </div>
                ))}
                {breakdown.hotelOptions.map(o => (
                  <div key={o.hotelRoomScheduleId} className="flex items-center justify-between rounded-lg bg-admin-warning/10 px-4 py-2">
                    <span className="text-[13px] text-admin-ink">Hotel — {o.hotelName} ({o.roomTypeName}, {o.nights} mlm)</span>
                    <span className="text-[13px] font-medium text-admin-warning">+{rupiah(o.pricePerNight)}/kamar/malam</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
