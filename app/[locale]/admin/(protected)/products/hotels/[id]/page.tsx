'use client'

import { useState, useEffect } from 'react'
import { Plus, ArrowLeft, Save, Wallet, Trash2, Pencil } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { useParams } from 'next/navigation'
import { MediaField } from '@/components/admin/media/MediaField'
import { HOTEL_FACILITIES } from '@/lib/constants/hotelFacilities'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { VendorPicker } from '@/components/admin/vendor/VendorPicker'

const CURRENCIES = ['USD', 'SAR', 'EUR', 'IDR']

type RoomType = { id: string; name: string; defaultCapacity: number }
type Schedule = {
  id: string; roomTypeId: string; roomType: RoomType
  price: number; totalQuota: number; pendingQuota: number; bookedQuota: number; isActive: boolean
}
type Period = {
  id: string; periodStart: string; periodEnd: string; isActive: boolean
  schedules: Schedule[]
}
type AddressRecord = {
  type: 'domestic' | 'international'; fullAddress: string; postalCode: string | null
  provinceId: string | null; regencyId: string | null; districtId: string | null; villageId: string | null
  countryCode: string | null; city: string | null; stateRegion: string | null
} | null
type Hotel = {
  id: string; name: string; city: string; stars: number | null
  distanceToHaramM: number | null; description: string | null
  facilities: string[]; isActive: boolean
  address: AddressRecord // docs/arsitektur-alamat.md §9
}

function toAddressValue(a: AddressRecord): AddressValue {
  if (!a) return EMPTY_ADDRESS
  return {
    type: a.type, fullAddress: a.fullAddress, postalCode: a.postalCode ?? '',
    provinceId: a.provinceId, regencyId: a.regencyId, districtId: a.districtId, villageId: a.villageId,
    countryCode: a.countryCode, city: a.city ?? '', stateRegion: a.stateRegion ?? '',
  }
}
type HotelService = {
  id: string; serviceName: string; serviceType: string | null
  price: number; description: string | null; isActive: boolean
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function HotelDetailPage() {
  const { id, locale } = useParams() as { id: string; locale: string }

  const [hotel, setHotel] = useState<Hotel | null>(null)
  const [form, setForm] = useState({
    name: '', city: 'makkah', stars: 4, distanceToHaramM: 500, description: '',
    facilities: [] as string[], isActive: true,
  })
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)


  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [showPeriodForm, setShowPeriodForm] = useState(false)
  const [savingPeriod, setSavingPeriod] = useState(false)
  const [periodForm, setPeriodForm] = useState({ periodStart: '', periodEnd: '' })
  const [periodError, setPeriodError] = useState('')

  const [expandedPeriodId, setExpandedPeriodId] = useState<string | null>(null)

  const [services, setServices] = useState<HotelService[]>([])
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null)
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [savingService, setSavingService] = useState(false)
  const [serviceForm, setServiceForm] = useState({ serviceName: '', serviceType: '', price: '', description: '', isActive: true })

  async function loadHotel() {
    const r = await fetch(`/api/v1/admin/products/hotels/${id}`)
    const j = await r.json()
    if (j.data) {
      const h: Hotel = j.data
      setHotel(h)
      setForm({
        name: h.name, city: h.city, stars: h.stars ?? 4,
        distanceToHaramM: h.distanceToHaramM ?? 0, description: h.description ?? '',
        facilities: Array.isArray(h.facilities) ? h.facilities : [], isActive: h.isActive,
      })
      setAddress(toAddressValue(h.address))
    }
  }
  async function loadRoomTypes() {
    const r = await fetch('/api/v1/admin/products/hotels/room-types')
    const j = await r.json()
    setRoomTypes(j.data ?? [])
  }
  async function loadPeriods() {
    const r = await fetch(`/api/v1/admin/products/hotels/${id}/periods`)
    const j = await r.json()
    setPeriods(j.data ?? [])
  }
  async function loadServices() {
    const r = await fetch(`/api/v1/admin/products/hotels/${id}/services`)
    const j = await r.json()
    setServices(j.data ?? [])
  }

  useEffect(() => { loadHotel(); loadRoomTypes(); loadPeriods(); loadServices() }, [id])

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }
  function toggleFacility(code: string) {
    setForm(p => ({
      ...p,
      facilities: p.facilities.includes(code) ? p.facilities.filter(c => c !== code) : [...p.facilities, code],
    }))
  }

  async function handleSave() {
    setSaving(true)
    await fetch(`/api/v1/admin/products/hotels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form, stars: +form.stars, distanceToHaramM: +form.distanceToHaramM,
        ...(address.fullAddress.trim() ? { address } : {}),
      }),
    })
    await loadHotel()
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleSavePeriod() {
    setSavingPeriod(true); setPeriodError('')
    const r = await fetch(`/api/v1/admin/products/hotels/${id}/periods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(periodForm),
    })
    const j = await r.json()
    setSavingPeriod(false)
    if (j.success) {
      await loadPeriods()
      setShowPeriodForm(false)
      setPeriodForm({ periodStart: '', periodEnd: '' })
      if (j.data?.id) setExpandedPeriodId(j.data.id)
    } else {
      setPeriodError(j.error ?? 'Gagal menyimpan periode')
    }
  }

  function openServiceForm(s?: HotelService) {
    if (s) {
      setEditingServiceId(s.id)
      setServiceForm({
        serviceName: s.serviceName, serviceType: s.serviceType ?? '',
        price: String(s.price), description: s.description ?? '', isActive: s.isActive,
      })
    } else {
      setEditingServiceId(null)
      setServiceForm({ serviceName: '', serviceType: '', price: '', description: '', isActive: true })
    }
    setShowServiceForm(true)
  }

  async function handleSaveService() {
    setSavingService(true)
    const body = {
      serviceName: serviceForm.serviceName,
      serviceType: serviceForm.serviceType || null,
      price: +serviceForm.price,
      description: serviceForm.description || null,
      isActive: serviceForm.isActive,
    }
    if (editingServiceId) {
      await fetch(`/api/v1/admin/products/hotels/${id}/services/${editingServiceId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    } else {
      await fetch(`/api/v1/admin/products/hotels/${id}/services`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    }
    await loadServices()
    setSavingService(false); setShowServiceForm(false)
  }

  async function handleDeleteService(serviceId: string) {
    if (!confirm('Hapus layanan ini?')) return
    await fetch(`/api/v1/admin/products/hotels/${id}/services/${serviceId}`, { method: 'DELETE' })
    await loadServices()
  }

  if (!hotel) {
    return <div className="flex items-center justify-center py-20 text-admin-muted/70 text-sm">Memuat data hotel…</div>
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <a
          href={`/${locale}/admin/products/hotels`}
          className="inline-flex items-center gap-1.5 text-[12px] text-admin-muted hover:text-admin-ink transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke daftar hotel
        </a>
        <h1 className="admin-h1 flex items-center gap-2">
          {hotel.name}
          <span className="text-admin-gold-strong text-lg">{'★'.repeat(form.stars)}</span>
        </h1>
      </div>

      {/* Informasi Dasar */}
      <div className="admin-form-panel space-y-4">
        <p className="text-sm font-semibold text-admin-ink">Informasi Dasar</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-admin-muted mb-1">Nama Hotel</p>
            <input className="admin-inp" value={form.name} onChange={set('name')} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Kota</p>
            <select className="admin-select" value={form.city} onChange={set('city')}>
              <option value="makkah">Makkah</option>
              <option value="madinah">Madinah</option>
            </select>
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Bintang</p>
            <input type="number" min={1} max={5} className="admin-inp" value={form.stars} onChange={set('stars')} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Jarak ke Haram (meter)</p>
            <input type="number" className="admin-inp" value={form.distanceToHaramM} onChange={set('distanceToHaramM')} />
          </div>
          <div className="md:col-span-2 min-w-0">
            <p className="text-xs text-admin-muted mb-1">Deskripsi</p>
            <RichTextEditor id="hotel-description" title="Deskripsi hotel" value={form.description} onChange={description => setForm(p => ({ ...p, description }))} placeholder="Tentang hotel, lokasi, fasilitas unggulan, catatan untuk jamaah…" />
          </div>
        </div>

        <div>
          <p className="text-xs text-admin-muted mb-2">Fasilitas</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {HOTEL_FACILITIES.map(f => (
              <label key={f.code} className="flex items-center gap-2 text-[13px] text-admin-ink/80 cursor-pointer">
                <input
                  type="checkbox" className="h-3.5 w-3.5"
                  checked={form.facilities.includes(f.code)}
                  onChange={() => toggleFacility(f.code)}
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-admin-muted mb-2">Alamat (docs/arsitektur-alamat.md)</p>
          <AddressPicker value={address} onChange={setAddress} />
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <div
            onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-admin-ink">Aktif (tampil di katalog)</span>
        </label>

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
          </button>
        </div>
      </div>

      {/* Foto */}
      <div className="admin-card p-5">
        <MediaField productType="hotel" productId={hotel.id} label="Foto Hotel" />
      </div>

      {/* Periode & Harga Kamar */}
      <div className="admin-form-panel space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-admin-ink">Periode &amp; Harga Kamar</p>
            <p className="text-[11px] text-admin-muted/70 mt-0.5">
              Satu periode tanggal bisa punya harga berbeda untuk banyak tipe kamar sekaligus — sama seperti rate sheet dari vendor.
            </p>
          </div>
          <button onClick={() => setShowPeriodForm(!showPeriodForm)} className="admin-btn-sm flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Tambah Periode
          </button>
        </div>

        {showPeriodForm && (
          <div className="border border-admin-line rounded-xl p-4 space-y-3 bg-admin-spot/30">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-admin-muted mb-1">Periode Mulai</p>
                <input type="date" className="admin-inp" value={periodForm.periodStart} onChange={e => setPeriodForm(f => ({ ...f, periodStart: e.target.value }))} />
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">Periode Akhir</p>
                <input type="date" className="admin-inp" value={periodForm.periodEnd} onChange={e => setPeriodForm(f => ({ ...f, periodEnd: e.target.value }))} />
              </div>
            </div>
            {periodError && <p className="text-[12px] text-admin-danger">{periodError}</p>}
            <p className="text-[11px] text-admin-muted/70">Harga tiap tipe kamar diisi setelah periode dibuat.</p>
            <div className="flex gap-2">
              <button
                onClick={handleSavePeriod}
                disabled={savingPeriod || !periodForm.periodStart || !periodForm.periodEnd}
                className="admin-btn-sm disabled:opacity-50"
              >
                {savingPeriod ? 'Menyimpan...' : 'Simpan Periode →'}
              </button>
              <button onClick={() => setShowPeriodForm(false)} className="admin-btn-ghost text-sm">Batal</button>
            </div>
          </div>
        )}

        {periods.length === 0 && !showPeriodForm && (
          <p className="text-[13px] text-admin-muted/70 py-4 text-center border border-dashed border-admin-line rounded-xl">
            Belum ada periode harga. Klik &quot;Tambah Periode&quot; untuk mulai.
          </p>
        )}

        <div className="space-y-2">
          {periods.map(p => (
            <PeriodRow
              key={p.id}
              period={p}
              hotelId={hotel.id}
              roomTypes={roomTypes}
              expanded={expandedPeriodId === p.id}
              onToggle={() => setExpandedPeriodId(expandedPeriodId === p.id ? null : p.id)}
              onSaved={loadPeriods}
            />
          ))}
        </div>
      </div>

      {/* Layanan Hotel — menutup Gap #3 (docs/arsitektur-hotel.md §8): dulu tidak ada jalur admin */}
      <div className="admin-form-panel space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-admin-ink">Layanan Hotel</p>
            <p className="text-[11px] text-admin-muted/70 mt-0.5">Layanan tambahan (mis. airport pickup, laundry) yang tampil di halaman publik hotel ini.</p>
          </div>
          <button onClick={() => openServiceForm()} className="admin-btn-sm flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Tambah Layanan
          </button>
        </div>

        {showServiceForm && (
          <div className="border border-admin-line rounded-xl p-4 space-y-3 bg-admin-spot/30">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-admin-muted mb-1">Nama Layanan</p>
                <input className="admin-inp" value={serviceForm.serviceName}
                  onChange={e => setServiceForm(f => ({ ...f, serviceName: e.target.value }))}
                  placeholder="Airport Pickup" />
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">Tipe (opsional)</p>
                <input className="admin-inp" value={serviceForm.serviceType}
                  onChange={e => setServiceForm(f => ({ ...f, serviceType: e.target.value }))}
                  placeholder="transport / laundry / lainnya" />
              </div>
              <div>
                <p className="text-xs text-admin-muted mb-1">Harga (Rupiah)</p>
                <input type="number" className="admin-inp" value={serviceForm.price}
                  onChange={e => setServiceForm(f => ({ ...f, price: e.target.value }))} placeholder="0" />
              </div>
              <div className="md:col-span-2">
                <p className="text-xs text-admin-muted mb-1">Deskripsi (opsional)</p>
                <input className="admin-inp" value={serviceForm.description}
                  onChange={e => setServiceForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveService} disabled={savingService || !serviceForm.serviceName || !serviceForm.price}
                className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
                <Save className="h-3.5 w-3.5" /> {savingService ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button onClick={() => setShowServiceForm(false)} className="admin-btn-ghost text-sm">Batal</button>
            </div>
          </div>
        )}

        {services.length === 0 && !showServiceForm && (
          <p className="text-[13px] text-admin-muted/70 py-4 text-center border border-dashed border-admin-line rounded-xl">
            Belum ada layanan tambahan untuk hotel ini.
          </p>
        )}

        <div className="space-y-2">
          {services.map(s => (
            <div key={s.id} className={`flex items-center justify-between rounded-lg border px-4 py-2.5 ${!s.isActive ? 'opacity-50' : ''}`}>
              <div>
                <p className="text-[13px] font-medium text-admin-ink">{s.serviceName}</p>
                <p className="text-[11px] text-admin-muted">{formatRupiah(s.price)}{s.serviceType ? ` · ${s.serviceType}` : ''}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={s.isActive ? 'admin-badge-green' : 'admin-badge-gray'}>{s.isActive ? 'Aktif' : 'Nonaktif'}</span>
                <button onClick={() => openServiceForm(s)} className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-ink hover:bg-admin-spot transition-colors">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDeleteService(s.id)} className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div className="admin-form-panel border-admin-danger/20 space-y-3">
        <p className="text-sm font-semibold text-admin-danger">Zona Berbahaya</p>
        <p className="text-[12px] text-admin-muted">Nonaktifkan hotel ini lewat toggle "Aktif" di atas — hapus permanen belum didukung dari sini.</p>
      </div>
    </div>
  )
}

type RoomPriceInput = { hargaKamar: string; totalQuota: string; preview: { hppRupiah: number; sellPrice: number } | null }

function PeriodRow({ period, hotelId, roomTypes, expanded, onToggle, onSaved }: {
  period: Period; hotelId: string; roomTypes: RoomType[]
  expanded: boolean; onToggle: () => void; onSaved: () => void
}) {
  const [vendorId, setVendorId] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [rooms, setRooms] = useState<Record<string, RoomPriceInput>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  async function loadPrices() {
    const r = await fetch(`/api/v1/admin/products/hotels/${hotelId}/periods/${period.id}/prices`)
    const j = await r.json()
    if (j.data) {
      setVendorId(j.data.vendorId ?? '')
      setCurrency(j.data.currency ?? 'USD')
      const next: Record<string, RoomPriceInput> = {}
      for (const row of j.data.rooms as { roomTypeId: string; cost: number | null; totalQuota: number }[]) {
        next[row.roomTypeId] = { hargaKamar: row.cost ? String(row.cost) : '', totalQuota: String(row.totalQuota), preview: null }
      }
      setRooms(next)
    }
    setLoaded(true)
  }

  useEffect(() => { if (expanded && !loaded) loadPrices() }, [expanded, loaded])

  function updateRoom(roomTypeId: string, field: 'hargaKamar' | 'totalQuota', value: string) {
    setRooms(p => ({
      ...p,
      [roomTypeId]: { hargaKamar: '', totalQuota: '10', preview: null, ...p[roomTypeId], [field]: value },
    }))
  }

  // Live preview per tipe kamar — debounce 500ms, panggil endpoint simulate yang sama dipakai §10.
  useEffect(() => {
    const timer = setTimeout(async () => {
      const entries = Object.entries(rooms).filter(([, v]) => Number(v.hargaKamar) > 0)
      if (entries.length === 0) return
      const results = await Promise.all(entries.map(async ([roomTypeId, v]) => {
        const params = new URLSearchParams({ hargaKamar: v.hargaKamar, currency })
        const r = await fetch(`/api/v1/admin/products/hotels/simulate?${params}`)
        const j = await r.json()
        return [roomTypeId, j.data ? { hppRupiah: j.data.hppRupiah, sellPrice: j.data.sellPrice } : null] as const
      }))
      setRooms(p => {
        const next = { ...p }
        for (const [roomTypeId, preview] of results) {
          if (next[roomTypeId]) next[roomTypeId] = { ...next[roomTypeId], preview }
        }
        return next
      })
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, JSON.stringify(Object.fromEntries(Object.entries(rooms).map(([k, v]) => [k, v.hargaKamar])))])

  const filledRooms = Object.entries(rooms).filter(([, v]) => Number(v.hargaKamar) > 0)
  const canSave = !!vendorId && filledRooms.length > 0

  async function handleSaveAll() {
    setSaving(true)
    setSaveError(null)
    const r = await fetch(`/api/v1/admin/products/hotels/${hotelId}/periods/${period.id}/prices`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorId, currency,
        rooms: filledRooms.map(([roomTypeId, v]) => ({
          roomTypeId, cost: Number(v.hargaKamar), totalQuota: Number(v.totalQuota || 0),
        })),
      }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => null)
      setSaveError(j?.error ?? 'Harga gagal disimpan.')
      setSaving(false)
      return
    }
    await onSaved()
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const prices = period.schedules.map(s => s.price)
  const priceRange: { min: number; max: number } | null = prices.length > 0
    ? { min: Math.min(...prices), max: Math.max(...prices) }
    : null

  return (
    <div className={`border rounded-xl overflow-hidden ${!period.isActive ? 'opacity-50 border-admin-line' : 'border-admin-line'}`}>
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 hover:bg-admin-spot/30 transition-colors text-left">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-admin-ink">
            {formatDate(period.periodStart)} – {formatDate(period.periodEnd)}
          </span>
          <span className="text-[11px] text-admin-muted">{period.schedules.length} tipe kamar terisi</span>
        </div>
        <span className="text-[13px] font-bold text-admin-ink">
          {priceRange
            ? priceRange.min === priceRange.max ? formatRupiah(priceRange.min) : `${formatRupiah(priceRange.min)} – ${formatRupiah(priceRange.max)}`
            : 'Belum ada harga'}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-admin-line p-4 space-y-3 bg-admin-spot/20">
          <p className="text-xs font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Vendor &amp; Mata Uang (berlaku untuk semua tipe kamar di periode ini)</p>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <VendorPicker value={vendorId} onChange={setVendorId} context="hotel" label="Vendor hotel" />
            </div>
            <select className="admin-inp w-20 shrink-0" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-admin-muted/70 font-medium px-1">
              <span className="w-24">Tipe Kamar</span>
              <span className="w-24">Harga ({currency})</span>
              <span className="w-20">Kuota</span>
              <span className="w-28">HPP</span>
              <span className="w-32">Harga Jual</span>
            </div>
            {roomTypes.map(rt => {
              const v = rooms[rt.id] ?? { hargaKamar: '', totalQuota: '10', preview: null }
              return (
                <div key={rt.id} className="flex items-center gap-2">
                  <span className="w-24 text-[12.5px] text-admin-ink/80 truncate">{rt.name}</span>
                  <input
                    type="number" className="admin-inp w-24" placeholder="0"
                    value={v.hargaKamar} onChange={e => updateRoom(rt.id, 'hargaKamar', e.target.value)}
                  />
                  <input
                    type="number" className="admin-inp w-20" placeholder="Kuota"
                    value={v.totalQuota} onChange={e => updateRoom(rt.id, 'totalQuota', e.target.value)}
                  />
                  <span className="w-28 text-[12.5px] font-semibold text-admin-ink truncate">
                    {v.preview ? formatRupiah(Math.round(v.preview.hppRupiah)) : '—'}
                  </span>
                  <span className="w-32 text-[12.5px] font-semibold text-admin-ink truncate">
                    {v.preview ? formatRupiah(v.preview.sellPrice) : '—'}
                  </span>
                </div>
              )
            })}
          </div>

          <button
            onClick={handleSaveAll}
            disabled={saving || !canSave}
            className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan Semua Harga'}
          </button>
          {saveError && <p role="alert" className="text-[12px] font-medium text-admin-danger">{saveError}</p>}
        </div>
      )}
    </div>
  )
}
