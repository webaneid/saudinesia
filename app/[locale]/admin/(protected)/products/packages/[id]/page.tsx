'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Plus, Trash2, Building2, Bus, Users, FileText, Plane, Utensils, Package as PackageIcon } from 'lucide-react'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { CostComponentsPanel } from '@/components/admin/pricing/CostComponentsPanel'
import { MediaField } from '@/components/admin/media/MediaField'

type Mode = 'included' | 'user_choice' | 'none'

const MODE_LABEL: Record<Mode, string> = {
  included: 'Sudah Termasuk (Included)',
  user_choice: 'Pilih Sendiri saat Booking (User Choice)',
  none: 'Tidak Dipakai (None)',
}

type HotelScheduleOption = { id: string; hotelName: string; city: string; roomTypeName: string; price: number }
type TripPricing = { id: string; price: string; vehicle: { name: string } }
type Trip = { id: string; name: string; category: string | null; origin: string; destination: string; isActive: boolean; pricing: TripPricing[] }
type VisaProductRow = { id: string; name: string; visaType: string; price: string }
type FlightScheduleRow = { id: string; price: string; departureFrom: string; departureTo: string; isActive: boolean; route: { id: string; origin: string; destination: string; isActive: boolean } }
type CateringOptionRow = { id: string; name: string; pricePerPersonRegular: string }

type HotelSlotSchedule = { period: { hotel: { name: string } }; roomType: { name: string } } | null
type PackageHotelOptionRow = { id: string; slot: string; hotelRoomScheduleId: string; nights: number; hotelRoomSchedule: { period: { hotel: { name: string } }; roomType: { name: string } } }
type PackageVisaOptionRow = { id: string; visaProductId: string; visaProduct: { name: string; price: string } }
type PackageCateringOptionRow = { id: string; cateringOptionId: string; numPeople: number; numDays: number; cateringOption: { name: string } }

type PackageDetail = {
  id: string; name: string; description: string | null; priceLabel: string | null; highlights: string[]; isActive: boolean; isFeatured: boolean

  hotelMakkahMode: Mode
  includedHotelMakkahScheduleId: string | null; includedHotelMakkahNights: number | null; includedHotelMakkahNumRooms: number | null; includedHotelMakkahPrice: string | null
  includedHotelMakkahSchedule: HotelSlotSchedule
  hotelMadinahMode: Mode
  includedHotelMadinahScheduleId: string | null; includedHotelMadinahNights: number | null; includedHotelMadinahNumRooms: number | null; includedHotelMadinahPrice: string | null
  includedHotelMadinahSchedule: HotelSlotSchedule
  hotelOptions: PackageHotelOptionRow[]

  transportMode: Mode; transportTripId: string | null; includedTransportPricingId: string | null; includedTransportPrice: string | null
  transportTrip: { name: string; origin: string; destination: string; pricing: TripPricing[] } | null
  includedTransportPricing: { vehicle: { name: string } } | null

  muthowifMode: Mode; includedMuthowifPrice: string | null

  visaMode: Mode; includedVisaProductId: string | null; includedVisaPrice: string | null
  includedVisaProduct: { name: string } | null
  visaOptions: PackageVisaOptionRow[]

  flightMode: Mode; flightRouteId: string | null; includedFlightScheduleId: string | null; includedFlightPrice: string | null
  flightRoute: { origin: string; destination: string } | null
  includedFlightSchedule: { route: { origin: string; destination: string } } | null

  cateringMode: Mode; includedCateringOptionId: string | null; includedCateringNumPeople: number | null; includedCateringNumDays: number | null; includedCateringPrice: string | null
  includedCateringOption: { name: string } | null
  cateringOptions: PackageCateringOptionRow[]
}

type Breakdown = {
  components: { costComponent: string; vendorId: string; currency: string; hppRupiah: number; sellPrice: number }[]
  componentsTotalSellPrice: number
  hotelMakkahMode: Mode
  hotelMakkah: { hotelName: string; roomTypeName: string; nights: number; numRooms: number; pricePerNight: number; totalPrice: number } | null
  hotelMakkahOptions: { hotelRoomScheduleId: string; hotelName: string; roomTypeName: string; nights: number; pricePerNight: number }[]
  hotelMadinahMode: Mode
  hotelMadinah: { hotelName: string; roomTypeName: string; nights: number; numRooms: number; pricePerNight: number; totalPrice: number } | null
  hotelMadinahOptions: { hotelRoomScheduleId: string; hotelName: string; roomTypeName: string; nights: number; pricePerNight: number }[]
  transportMode: Mode
  includedTransportPrice: number | null; includedVehicleName: string | null
  vehicleOptions: { transportPricingId: string; vehicleName: string; vehiclePrice: number }[]
  muthowifMode: Mode
  includedMuthowifPrice: number | null; currentMuthowifPrice: number | null
  visaMode: Mode
  includedVisaPrice: number | null; includedVisaName: string | null
  visaOptions: { visaProductId: string; name: string; price: number }[]
  flightMode: Mode
  includedFlightPrice: number | null; includedFlightLabel: string | null
  flightOptions: { flightScheduleId: string; label: string; price: number }[]
  cateringMode: Mode
  includedCateringPrice: number | null; includedCateringName: string | null
  cateringOptions: { cateringOptionId: string; name: string; numPeople: number; numDays: number; price: number }[]
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

export default function PackageBuilderPage({ params }: Props) {
  const router = useRouter()
  const [id, setId] = useState('')
  const [locale, setLocale] = useState('id')
  const [loaded, setLoaded] = useState(false)

  const [pkg, setPkg] = useState<PackageDetail | null>(null)
  const [form, setForm] = useState({ name: '', description: '', priceLabel: '', highlights: '', isFeatured: false, isActive: true })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [allHotelSchedules, setAllHotelSchedules] = useState<HotelScheduleOption[]>([])
  const [allTrips, setAllTrips] = useState<Trip[]>([])
  const [allVisaProducts, setAllVisaProducts] = useState<VisaProductRow[]>([])
  const [allFlightSchedules, setAllFlightSchedules] = useState<FlightScheduleRow[]>([])
  const [allCateringOptions, setAllCateringOptions] = useState<CateringOptionRow[]>([])

  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)

  // Hotel Makkah/Madinah — form "tetapkan" untuk mode included
  const [hmForm, setHmForm] = useState({ scheduleId: '', nights: '1', numRooms: '1' })
  const [hdForm, setHdForm] = useState({ scheduleId: '', nights: '1', numRooms: '1' })
  const [addHmOption, setAddHmOption] = useState({ scheduleId: '', nights: '1' })
  const [addHdOption, setAddHdOption] = useState({ scheduleId: '', nights: '1' })

  // Kendaraan
  const [includedPricingChoice, setIncludedPricingChoice] = useState('')
  const [userChoiceTripId, setUserChoiceTripId] = useState('')

  // Visa
  const [addVisaOptionId, setAddVisaOptionId] = useState('')

  // Tiket Pesawat
  const [includedFlightChoice, setIncludedFlightChoice] = useState('')
  const [userChoiceFlightRouteId, setUserChoiceFlightRouteId] = useState('')

  // Katering
  const [cateringForm, setCateringForm] = useState({ optionId: '', numPeople: '1', numDays: '1' })
  const [addCateringOption, setAddCateringOption] = useState({ optionId: '', numPeople: '1', numDays: '1' })


  const loadPackage = useCallback(async (pkgId: string) => {
    const r = await fetch(`/api/v1/admin/products/packages/${pkgId}`)
    const j = await r.json()
    if (j.data) {
      const p: PackageDetail = j.data
      setPkg(p)
      setForm({
        name: p.name, description: p.description ?? '', priceLabel: p.priceLabel ?? '',
        highlights: (p.highlights ?? []).join('\n'), isFeatured: p.isFeatured, isActive: p.isActive,
      })
      setHmForm({ scheduleId: p.includedHotelMakkahScheduleId ?? '', nights: String(p.includedHotelMakkahNights ?? 1), numRooms: String(p.includedHotelMakkahNumRooms ?? 1) })
      setHdForm({ scheduleId: p.includedHotelMadinahScheduleId ?? '', nights: String(p.includedHotelMadinahNights ?? 1), numRooms: String(p.includedHotelMadinahNumRooms ?? 1) })
      setIncludedPricingChoice(p.transportTripId && p.includedTransportPricingId ? `${p.transportTripId}::${p.includedTransportPricingId}` : '')
      setUserChoiceTripId(p.transportMode === 'user_choice' ? (p.transportTripId ?? '') : '')
      setIncludedFlightChoice(p.flightRouteId && p.includedFlightScheduleId ? `${p.flightRouteId}::${p.includedFlightScheduleId}` : '')
      setUserChoiceFlightRouteId(p.flightMode === 'user_choice' ? (p.flightRouteId ?? '') : '')
      setCateringForm({ optionId: p.includedCateringOptionId ?? '', numPeople: String(p.includedCateringNumPeople ?? 1), numDays: String(p.includedCateringNumDays ?? 1) })
    }
  }, [])

  const loadBreakdown = useCallback(async (pkgId: string) => {
    const r = await fetch(`/api/v1/admin/products/packages/${pkgId}/breakdown`)
    const j = await r.json()
    setBreakdown(j.data ?? null)
  }, [])

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id); setLocale(p.locale)
      const [, tripsRes, hotelSchedulesRes, visaRes, flightSchedulesRes, cateringRes] = await Promise.all([
        loadPackage(p.id),
        fetch('/api/v1/admin/products/transport/trips').then(r => r.json()),
        fetch('/api/v1/admin/products/hotels/schedules').then(r => r.json()),
        fetch('/api/v1/admin/products/visa').then(r => r.json()),
        fetch('/api/v1/admin/products/flight/schedules').then(r => r.json()),
        fetch('/api/v1/admin/products/catering').then(r => r.json()),
      ])
      setAllTrips(tripsRes.data ?? [])
      setAllHotelSchedules(hotelSchedulesRes.data ?? [])
      setAllVisaProducts(visaRes.data ?? [])
      setAllFlightSchedules((flightSchedulesRes.data ?? []).filter((s: FlightScheduleRow) => s.isActive && s.route.isActive))
      setAllCateringOptions(cateringRes.data ?? [])
      await loadBreakdown(p.id)
      setLoaded(true)
    })
  }, [params, loadPackage, loadBreakdown])

  async function refreshAll() {
    await Promise.all([loadPackage(id), loadBreakdown(id)])
  }

  async function patch(body: Record<string, unknown>) {
    await fetch(`/api/v1/admin/products/packages/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    await refreshAll()
  }

  async function handleSaveInfo() {
    setSaving(true)
    await patch({
      name: form.name, description: form.description || null, priceLabel: form.priceLabel || null,
      highlights: form.highlights.split('\n').map(s => s.trim()).filter(Boolean),
      isFeatured: form.isFeatured, isActive: form.isActive,
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // Hotel Makkah
  async function handleSetHotelMakkahMode(mode: Mode) { await patch({ hotelMakkahMode: mode }) }
  async function handleSaveHotelMakkah() {
    await patch({
      includedHotelMakkahScheduleId: hmForm.scheduleId || null,
      includedHotelMakkahNights: hmForm.scheduleId ? Number(hmForm.nights) : null,
      includedHotelMakkahNumRooms: hmForm.scheduleId ? Number(hmForm.numRooms) : null,
    })
  }
  async function handleAddHotelOption(slot: 'makkah' | 'madinah') {
    const st = slot === 'makkah' ? addHmOption : addHdOption
    if (!st.scheduleId) return
    await fetch(`/api/v1/admin/products/packages/${id}/hotel-options`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, hotelRoomScheduleId: st.scheduleId, nights: Number(st.nights) }),
    })
    if (slot === 'makkah') setAddHmOption({ scheduleId: '', nights: '1' }); else setAddHdOption({ scheduleId: '', nights: '1' })
    await refreshAll()
  }
  async function handleRemoveHotelOption(slot: 'makkah' | 'madinah', hotelRoomScheduleId: string) {
    await fetch(`/api/v1/admin/products/packages/${id}/hotel-options`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, hotelRoomScheduleId }),
    })
    await refreshAll()
  }

  // Hotel Madinah
  async function handleSetHotelMadinahMode(mode: Mode) { await patch({ hotelMadinahMode: mode }) }
  async function handleSaveHotelMadinah() {
    await patch({
      includedHotelMadinahScheduleId: hdForm.scheduleId || null,
      includedHotelMadinahNights: hdForm.scheduleId ? Number(hdForm.nights) : null,
      includedHotelMadinahNumRooms: hdForm.scheduleId ? Number(hdForm.numRooms) : null,
    })
  }

  // Kendaraan
  async function handleSetTransportMode(mode: Mode) {
    const body: Record<string, unknown> = { transportMode: mode }
    if (mode !== 'included') body.includedTransportPricingId = null
    if (mode !== 'user_choice') body.transportTripId = null
    await patch(body)
  }
  async function handleSetIncludedPricing(value: string) {
    setIncludedPricingChoice(value)
    if (!value) return
    const [tripId, pricingId] = value.split('::')
    await patch({ transportTripId: tripId, includedTransportPricingId: pricingId })
  }
  async function handleSetUserChoiceTrip(tripId: string) {
    setUserChoiceTripId(tripId)
    await patch({ transportTripId: tripId || null })
  }

  // Muthowif
  async function handleSetMuthowifMode(mode: Mode) { await patch({ muthowifMode: mode }) }

  // Visa
  async function handleSetVisaMode(mode: Mode) {
    const body: Record<string, unknown> = { visaMode: mode }
    if (mode !== 'included') body.includedVisaProductId = null
    await patch(body)
  }
  async function handleSetIncludedVisa(visaProductId: string) {
    if (!visaProductId) return
    await patch({ includedVisaProductId: visaProductId })
  }
  async function handleAddVisaOption() {
    if (!addVisaOptionId) return
    await fetch(`/api/v1/admin/products/packages/${id}/visa-options`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visaProductId: addVisaOptionId }),
    })
    setAddVisaOptionId(''); await refreshAll()
  }
  async function handleRemoveVisaOption(visaProductId: string) {
    await fetch(`/api/v1/admin/products/packages/${id}/visa-options`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visaProductId }),
    })
    await refreshAll()
  }

  // Tiket Pesawat
  async function handleSetFlightMode(mode: Mode) {
    const body: Record<string, unknown> = { flightMode: mode }
    if (mode !== 'included') body.includedFlightScheduleId = null
    if (mode !== 'user_choice') body.flightRouteId = null
    await patch(body)
  }
  async function handleSetIncludedFlight(value: string) {
    setIncludedFlightChoice(value)
    if (!value) return
    const [routeId, scheduleId] = value.split('::')
    await patch({ flightRouteId: routeId, includedFlightScheduleId: scheduleId })
  }
  async function handleSetUserChoiceFlightRoute(routeId: string) {
    setUserChoiceFlightRouteId(routeId)
    await patch({ flightRouteId: routeId || null })
  }

  // Katering
  async function handleSetCateringMode(mode: Mode) { await patch({ cateringMode: mode }) }
  async function handleSaveCatering() {
    await patch({
      includedCateringOptionId: cateringForm.optionId || null,
      includedCateringNumPeople: cateringForm.optionId ? Number(cateringForm.numPeople) : null,
      includedCateringNumDays: cateringForm.optionId ? Number(cateringForm.numDays) : null,
    })
  }
  async function handleAddCateringOption() {
    if (!addCateringOption.optionId) return
    await fetch(`/api/v1/admin/products/packages/${id}/catering-options`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cateringOptionId: addCateringOption.optionId, numPeople: Number(addCateringOption.numPeople), numDays: Number(addCateringOption.numDays) }),
    })
    setAddCateringOption({ optionId: '', numPeople: '1', numDays: '1' }); await refreshAll()
  }
  async function handleRemoveCateringOption(cateringOptionId: string) {
    await fetch(`/api/v1/admin/products/packages/${id}/catering-options`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cateringOptionId }),
    })
    await refreshAll()
  }

  if (!loaded || !pkg) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  const makkahSchedules = allHotelSchedules.filter(s => s.city.toLowerCase() === 'makkah')
  const madinahSchedules = allHotelSchedules.filter(s => s.city.toLowerCase() === 'madinah')
  const availableHmOptionSchedules = makkahSchedules.filter(s => !pkg.hotelOptions.some(o => o.slot === 'makkah' && o.hotelRoomScheduleId === s.id))
  const availableHdOptionSchedules = madinahSchedules.filter(s => !pkg.hotelOptions.some(o => o.slot === 'madinah' && o.hotelRoomScheduleId === s.id))
  const allPricingFlat = allTrips.filter(t => t.isActive).flatMap(t => t.pricing.map(p => ({ tripId: t.id, tripName: t.name, ...p })))
  const availableVisaOptions = allVisaProducts.filter(v => !pkg.visaOptions.some(o => o.visaProductId === v.id))
  const uniqueFlightRoutes = Array.from(new Map(allFlightSchedules.map(s => [s.route.id, s.route])).values())
  const availableCateringOptions = allCateringOptions.filter(c => !pkg.cateringOptions.some(o => o.cateringOptionId === c.id))

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/${locale}/admin/products/packages`)}
          className="text-admin-muted/70 hover:text-admin-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1 flex items-center gap-2"><PackageIcon className="h-5 w-5 text-admin-primary-medium" /> {pkg.name}</h1>
      </div>

      <div className="admin-form-panel">
        <MediaField productType="package" productId={pkg.id} label="Foto Unggulan Paket Umroh" />
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
            <RichTextEditor id="package-description" title="Deskripsi paket umroh" value={form.description} onChange={description => setForm(f => ({ ...f, description }))} placeholder="Ringkasan paket, program, dan keunggulan…" />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Label Harga</p>
            <input className="admin-inp" placeholder="per orang" value={form.priceLabel} onChange={e => setForm(f => ({ ...f, priceLabel: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2 self-end pb-2">
            <input type="checkbox" id="featured" checked={form.isFeatured} onChange={e => setForm(p => ({ ...p, isFeatured: e.target.checked }))} className="h-4 w-4 accent-admin-accent" />
            <label htmlFor="featured" className="text-sm text-admin-ink/80">Tampilkan di halaman utama</label>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-admin-muted mb-1">Highlight (satu baris per poin)</p>
            <textarea className="admin-inp" rows={3} value={form.highlights} onChange={e => setForm(f => ({ ...f, highlights: e.target.value }))}
              placeholder={"Hotel bintang 5 Makkah & Madinah\nVisa Umroh termasuk\nMuthowif berpengalaman"} />
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

      {/* Hotel Makkah */}
      <div className="admin-card p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Building2 className="h-4 w-4 text-admin-accent" /> Hotel Makkah</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">Pilih bagaimana hotel Makkah masuk ke paket ini — lihat docs/arsitektur-paket-umroh.md §3</p>
        </div>
        <ModeSelector value={pkg.hotelMakkahMode} onChange={handleSetHotelMakkahMode} />

        {pkg.hotelMakkahMode === 'included' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-accent-strong bg-admin-accent/10 rounded px-2 py-1 w-fit">Harga hotel ini MASUK ke Harga Jual Paket — pilgrim tidak memilih hotel Makkah saat booking.</p>
            {pkg.includedHotelMakkahSchedule && pkg.includedHotelMakkahPrice != null && pkg.includedHotelMakkahNights != null && pkg.includedHotelMakkahNumRooms != null && (
              <p className="text-[12px] text-admin-muted">Dikunci: <span className="font-medium text-admin-ink">{pkg.includedHotelMakkahSchedule.period.hotel.name} — {pkg.includedHotelMakkahSchedule.roomType.name}</span> — {pkg.includedHotelMakkahNights} malam × {pkg.includedHotelMakkahNumRooms} kamar × {rupiah(Number(pkg.includedHotelMakkahPrice))} = {rupiah(pkg.includedHotelMakkahNights * pkg.includedHotelMakkahNumRooms * Number(pkg.includedHotelMakkahPrice))}</p>
            )}
            <div className="grid md:grid-cols-4 gap-2">
              <select className="admin-select md:col-span-2" value={hmForm.scheduleId} onChange={e => setHmForm(f => ({ ...f, scheduleId: e.target.value }))}>
                <option value="">— pilih hotel + tipe kamar —</option>
                {makkahSchedules.map(s => <option key={s.id} value={s.id}>{s.hotelName} — {s.roomTypeName} ({rupiah(s.price)}/mlm)</option>)}
              </select>
              <input className="admin-inp" type="number" min={1} placeholder="Malam" value={hmForm.nights} onChange={e => setHmForm(f => ({ ...f, nights: e.target.value }))} />
              <input className="admin-inp" type="number" min={1} placeholder="Kamar" value={hmForm.numRooms} onChange={e => setHmForm(f => ({ ...f, numRooms: e.target.value }))} />
            </div>
            <button onClick={handleSaveHotelMakkah} disabled={!hmForm.scheduleId} className="admin-btn-sm disabled:opacity-50 w-fit">Tetapkan</button>
          </div>
        )}

        {pkg.hotelMakkahMode === 'user_choice' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-warning bg-admin-warning/10 rounded px-2 py-1 w-fit">Harga hotel Makkah TIDAK masuk Harga Jual Paket — pilgrim pilih sendiri saat booking.</p>
            <div className="space-y-2">
              {pkg.hotelOptions.filter(o => o.slot === 'makkah').map(o => (
                <div key={o.id} className="flex items-center justify-between rounded-lg border border-admin-line px-4 py-2.5">
                  <p className="text-[13px] font-medium text-admin-ink">{o.hotelRoomSchedule.period.hotel.name} — {o.hotelRoomSchedule.roomType.name} <span className="text-admin-muted/70 font-normal">({o.nights} malam)</span></p>
                  <button onClick={() => handleRemoveHotelOption('makkah', o.hotelRoomScheduleId)}
                    className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {pkg.hotelOptions.filter(o => o.slot === 'makkah').length === 0 && <p className="text-sm text-admin-muted/70 py-2">Belum ada opsi hotel Makkah ditawarkan.</p>}
            </div>
            <div className="flex gap-2 pt-1">
              <select className="admin-select flex-1" value={addHmOption.scheduleId} onChange={e => setAddHmOption(f => ({ ...f, scheduleId: e.target.value }))}>
                <option value="">— pilih hotel + tipe kamar untuk ditawarkan —</option>
                {availableHmOptionSchedules.map(s => <option key={s.id} value={s.id}>{s.hotelName} — {s.roomTypeName} ({rupiah(s.price)}/mlm)</option>)}
              </select>
              <input className="admin-inp w-24" type="number" min={1} placeholder="Malam" value={addHmOption.nights} onChange={e => setAddHmOption(f => ({ ...f, nights: e.target.value }))} />
              <button onClick={() => handleAddHotelOption('makkah')} disabled={!addHmOption.scheduleId} className="admin-btn-sm disabled:opacity-50 shrink-0 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Tambah
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hotel Madinah */}
      <div className="admin-card p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Building2 className="h-4 w-4 text-admin-accent" /> Hotel Madinah</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">Sama konsep dengan Hotel Makkah</p>
        </div>
        <ModeSelector value={pkg.hotelMadinahMode} onChange={handleSetHotelMadinahMode} />

        {pkg.hotelMadinahMode === 'included' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-accent-strong bg-admin-accent/10 rounded px-2 py-1 w-fit">Harga hotel ini MASUK ke Harga Jual Paket.</p>
            {pkg.includedHotelMadinahSchedule && pkg.includedHotelMadinahPrice != null && pkg.includedHotelMadinahNights != null && pkg.includedHotelMadinahNumRooms != null && (
              <p className="text-[12px] text-admin-muted">Dikunci: <span className="font-medium text-admin-ink">{pkg.includedHotelMadinahSchedule.period.hotel.name} — {pkg.includedHotelMadinahSchedule.roomType.name}</span> — {pkg.includedHotelMadinahNights} malam × {pkg.includedHotelMadinahNumRooms} kamar × {rupiah(Number(pkg.includedHotelMadinahPrice))} = {rupiah(pkg.includedHotelMadinahNights * pkg.includedHotelMadinahNumRooms * Number(pkg.includedHotelMadinahPrice))}</p>
            )}
            <div className="grid md:grid-cols-4 gap-2">
              <select className="admin-select md:col-span-2" value={hdForm.scheduleId} onChange={e => setHdForm(f => ({ ...f, scheduleId: e.target.value }))}>
                <option value="">— pilih hotel + tipe kamar —</option>
                {madinahSchedules.map(s => <option key={s.id} value={s.id}>{s.hotelName} — {s.roomTypeName} ({rupiah(s.price)}/mlm)</option>)}
              </select>
              <input className="admin-inp" type="number" min={1} placeholder="Malam" value={hdForm.nights} onChange={e => setHdForm(f => ({ ...f, nights: e.target.value }))} />
              <input className="admin-inp" type="number" min={1} placeholder="Kamar" value={hdForm.numRooms} onChange={e => setHdForm(f => ({ ...f, numRooms: e.target.value }))} />
            </div>
            <button onClick={handleSaveHotelMadinah} disabled={!hdForm.scheduleId} className="admin-btn-sm disabled:opacity-50 w-fit">Tetapkan</button>
          </div>
        )}

        {pkg.hotelMadinahMode === 'user_choice' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-warning bg-admin-warning/10 rounded px-2 py-1 w-fit">Harga hotel Madinah TIDAK masuk Harga Jual Paket — pilgrim pilih sendiri saat booking.</p>
            <div className="space-y-2">
              {pkg.hotelOptions.filter(o => o.slot === 'madinah').map(o => (
                <div key={o.id} className="flex items-center justify-between rounded-lg border border-admin-line px-4 py-2.5">
                  <p className="text-[13px] font-medium text-admin-ink">{o.hotelRoomSchedule.period.hotel.name} — {o.hotelRoomSchedule.roomType.name} <span className="text-admin-muted/70 font-normal">({o.nights} malam)</span></p>
                  <button onClick={() => handleRemoveHotelOption('madinah', o.hotelRoomScheduleId)}
                    className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {pkg.hotelOptions.filter(o => o.slot === 'madinah').length === 0 && <p className="text-sm text-admin-muted/70 py-2">Belum ada opsi hotel Madinah ditawarkan.</p>}
            </div>
            <div className="flex gap-2 pt-1">
              <select className="admin-select flex-1" value={addHdOption.scheduleId} onChange={e => setAddHdOption(f => ({ ...f, scheduleId: e.target.value }))}>
                <option value="">— pilih hotel + tipe kamar untuk ditawarkan —</option>
                {availableHdOptionSchedules.map(s => <option key={s.id} value={s.id}>{s.hotelName} — {s.roomTypeName} ({rupiah(s.price)}/mlm)</option>)}
              </select>
              <input className="admin-inp w-24" type="number" min={1} placeholder="Malam" value={addHdOption.nights} onChange={e => setAddHdOption(f => ({ ...f, nights: e.target.value }))} />
              <button onClick={() => handleAddHotelOption('madinah')} disabled={!addHdOption.scheduleId} className="admin-btn-sm disabled:opacity-50 shrink-0 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Tambah
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Kendaraan */}
      <div className="admin-card p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Bus className="h-4 w-4 text-admin-accent" /> Kendaraan</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">Pilih bagaimana kendaraan masuk ke paket ini</p>
        </div>
        <ModeSelector value={pkg.transportMode} onChange={handleSetTransportMode} />

        {pkg.transportMode === 'included' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-accent-strong bg-admin-accent/10 rounded px-2 py-1 w-fit">Harga kendaraan ini MASUK ke Harga Jual Paket — pilgrim tidak memilih kendaraan saat booking.</p>
            <select className="admin-select" value={includedPricingChoice} onChange={e => handleSetIncludedPricing(e.target.value)}>
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
            <select className="admin-select" value={userChoiceTripId} onChange={e => handleSetUserChoiceTrip(e.target.value)}>
              <option value="">— pilih trip sumber opsi kendaraan —</option>
              {allTrips.filter(t => t.isActive).map(t => <option key={t.id} value={t.id}>{t.name} ({t.origin} → {t.destination})</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Muthowif */}
      <div className="admin-card p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Users className="h-4 w-4 text-admin-accent" /> Muthowif</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">Harga jasa muthowif — singleton, tidak ada opsi untuk dipilih</p>
        </div>
        <ModeSelector value={pkg.muthowifMode} onChange={handleSetMuthowifMode} />

        {pkg.muthowifMode === 'included' && (
          <p className="text-[11px] text-admin-accent-strong bg-admin-accent/10 rounded px-2 py-1 w-fit">
            MASUK Harga Jual Paket{pkg.includedMuthowifPrice != null && ` — ${rupiah(Number(pkg.includedMuthowifPrice))}`} (harga referensi awal, bisa diedit lewat Komponen Biaya kalau perlu penyesuaian)
          </p>
        )}
        {pkg.muthowifMode === 'user_choice' && breakdown?.currentMuthowifPrice != null && (
          <p className="text-[11px] text-admin-warning bg-admin-warning/10 rounded px-2 py-1 w-fit">
            TIDAK masuk Harga Jual Paket — harga saat ini {rupiah(breakdown.currentMuthowifPrice)}, ditambahkan terpisah saat booking.
          </p>
        )}
      </div>

      {/* Visa */}
      <div className="admin-card p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><FileText className="h-4 w-4 text-admin-accent" /> Visa</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">Pilih bagaimana visa masuk ke paket ini</p>
        </div>
        <ModeSelector value={pkg.visaMode} onChange={handleSetVisaMode} />

        {pkg.visaMode === 'included' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-accent-strong bg-admin-accent/10 rounded px-2 py-1 w-fit">Harga visa ini MASUK ke Harga Jual Paket.</p>
            <select className="admin-select" defaultValue="" onChange={e => handleSetIncludedVisa(e.target.value)}>
              <option value="">— pilih produk visa —</option>
              {allVisaProducts.map(v => <option key={v.id} value={v.id}>{v.name} ({v.visaType}) — {rupiah(Number(v.price))}</option>)}
            </select>
            {pkg.includedVisaProduct && pkg.includedVisaPrice != null && (
              <p className="text-[12px] text-admin-muted">Dikunci: <span className="font-medium text-admin-ink">{pkg.includedVisaProduct.name}</span> — {rupiah(Number(pkg.includedVisaPrice))}</p>
            )}
          </div>
        )}

        {pkg.visaMode === 'user_choice' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-warning bg-admin-warning/10 rounded px-2 py-1 w-fit">Harga visa TIDAK masuk Harga Jual Paket — ditawarkan sebagai opsi.</p>
            <div className="space-y-2">
              {pkg.visaOptions.map(o => (
                <div key={o.id} className="flex items-center justify-between rounded-lg border border-admin-line px-4 py-2.5">
                  <p className="text-[13px] font-medium text-admin-ink">{o.visaProduct.name} <span className="text-admin-muted/70 font-normal">({rupiah(Number(o.visaProduct.price))})</span></p>
                  <button onClick={() => handleRemoveVisaOption(o.visaProductId)}
                    className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {pkg.visaOptions.length === 0 && <p className="text-sm text-admin-muted/70 py-2">Belum ada opsi visa ditawarkan.</p>}
            </div>
            <div className="flex gap-2 pt-1">
              <select className="admin-select flex-1" value={addVisaOptionId} onChange={e => setAddVisaOptionId(e.target.value)}>
                <option value="">— pilih produk visa untuk ditawarkan —</option>
                {availableVisaOptions.map(v => <option key={v.id} value={v.id}>{v.name} ({v.visaType})</option>)}
              </select>
              <button onClick={handleAddVisaOption} disabled={!addVisaOptionId} className="admin-btn-sm disabled:opacity-50 shrink-0 flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Tambah
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tiket Pesawat */}
      <div className="admin-card p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Plane className="h-4 w-4 text-admin-accent" /> Tiket Pesawat</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">Pilih bagaimana tiket pesawat masuk ke paket ini</p>
        </div>
        <ModeSelector value={pkg.flightMode} onChange={handleSetFlightMode} />

        {pkg.flightMode === 'included' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-accent-strong bg-admin-accent/10 rounded px-2 py-1 w-fit">Harga tiket ini MASUK ke Harga Jual Paket.</p>
            <select className="admin-select" value={includedFlightChoice} onChange={e => handleSetIncludedFlight(e.target.value)}>
              <option value="">— pilih jadwal penerbangan —</option>
              {allFlightSchedules.map(s => (
                <option key={s.id} value={`${s.route.id}::${s.id}`}>{s.route.origin} → {s.route.destination} ({rupiah(Number(s.price))})</option>
              ))}
            </select>
            {pkg.includedFlightSchedule && pkg.includedFlightPrice != null && (
              <p className="text-[12px] text-admin-muted">Dikunci: <span className="font-medium text-admin-ink">{pkg.includedFlightSchedule.route.origin} → {pkg.includedFlightSchedule.route.destination}</span> — {rupiah(Number(pkg.includedFlightPrice))}</p>
            )}
          </div>
        )}

        {pkg.flightMode === 'user_choice' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-warning bg-admin-warning/10 rounded px-2 py-1 w-fit">Harga tiket TIDAK masuk Harga Jual Paket — pilgrim pilih &amp; bayar sendiri saat booking.</p>
            <select className="admin-select" value={userChoiceFlightRouteId} onChange={e => handleSetUserChoiceFlightRoute(e.target.value)}>
              <option value="">— pilih rute sumber opsi tiket —</option>
              {uniqueFlightRoutes.map(r => <option key={r.id} value={r.id}>{r.origin} → {r.destination}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Katering */}
      <div className="admin-card p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Utensils className="h-4 w-4 text-admin-accent" /> Katering</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">Pilih bagaimana katering masuk ke paket ini</p>
        </div>
        <ModeSelector value={pkg.cateringMode} onChange={handleSetCateringMode} />

        {pkg.cateringMode === 'included' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-accent-strong bg-admin-accent/10 rounded px-2 py-1 w-fit">Harga katering ini MASUK ke Harga Jual Paket.</p>
            {pkg.includedCateringOption && pkg.includedCateringPrice != null && pkg.includedCateringNumPeople != null && pkg.includedCateringNumDays != null && (
              <p className="text-[12px] text-admin-muted">Dikunci: <span className="font-medium text-admin-ink">{pkg.includedCateringOption.name}</span> — {pkg.includedCateringNumPeople} orang × {pkg.includedCateringNumDays} hari = {rupiah(Number(pkg.includedCateringPrice))}</p>
            )}
            <div className="grid md:grid-cols-4 gap-2">
              <select className="admin-select md:col-span-2" value={cateringForm.optionId} onChange={e => setCateringForm(f => ({ ...f, optionId: e.target.value }))}>
                <option value="">— pilih menu katering —</option>
                {allCateringOptions.map(c => <option key={c.id} value={c.id}>{c.name} ({rupiah(Number(c.pricePerPersonRegular))}/orang/hari)</option>)}
              </select>
              <input className="admin-inp" type="number" min={1} placeholder="Orang" value={cateringForm.numPeople} onChange={e => setCateringForm(f => ({ ...f, numPeople: e.target.value }))} />
              <input className="admin-inp" type="number" min={1} placeholder="Hari" value={cateringForm.numDays} onChange={e => setCateringForm(f => ({ ...f, numDays: e.target.value }))} />
            </div>
            <button onClick={handleSaveCatering} disabled={!cateringForm.optionId} className="admin-btn-sm disabled:opacity-50 w-fit">Tetapkan</button>
          </div>
        )}

        {pkg.cateringMode === 'user_choice' && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-admin-warning bg-admin-warning/10 rounded px-2 py-1 w-fit">Harga katering TIDAK masuk Harga Jual Paket — ditawarkan sebagai opsi.</p>
            <div className="space-y-2">
              {pkg.cateringOptions.map(o => (
                <div key={o.id} className="flex items-center justify-between rounded-lg border border-admin-line px-4 py-2.5">
                  <p className="text-[13px] font-medium text-admin-ink">{o.cateringOption.name} <span className="text-admin-muted/70 font-normal">({o.numPeople} orang × {o.numDays} hari)</span></p>
                  <button onClick={() => handleRemoveCateringOption(o.cateringOptionId)}
                    className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {pkg.cateringOptions.length === 0 && <p className="text-sm text-admin-muted/70 py-2">Belum ada opsi katering ditawarkan.</p>}
            </div>
            <div className="grid md:grid-cols-4 gap-2">
              <select className="admin-select md:col-span-2" value={addCateringOption.optionId} onChange={e => setAddCateringOption(f => ({ ...f, optionId: e.target.value }))}>
                <option value="">— pilih menu untuk ditawarkan —</option>
                {availableCateringOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="admin-inp" type="number" min={1} placeholder="Orang" value={addCateringOption.numPeople} onChange={e => setAddCateringOption(f => ({ ...f, numPeople: e.target.value }))} />
              <input className="admin-inp" type="number" min={1} placeholder="Hari" value={addCateringOption.numDays} onChange={e => setAddCateringOption(f => ({ ...f, numDays: e.target.value }))} />
            </div>
            <button onClick={handleAddCateringOption} disabled={!addCateringOption.optionId} className="admin-btn-sm disabled:opacity-50 w-fit flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" /> Tambah
            </button>
          </div>
        )}
      </div>

      {/* Komponen biaya */}
      <CostComponentsPanel
        apiBase={`/api/v1/admin/products/packages/${id}/costs`}
        hint="Tiap komponen (dokumen, admin fee, dst) dapat margin sendiri, baru dijumlah ke harga paket — lihat docs/arsitektur-paket-umroh.md §5"
        namePlaceholder="Dokumen, Admin Fee, dst"
        onChanged={async () => { await Promise.all([loadBreakdown(id), loadPackage(id)]) }}
      />

      {/* Preview Harga — 2 blok: dasar (included) vs opsi tambahan (user_choice) */}
      {breakdown && (
        <div className="admin-card p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-admin-ink">Harga Jual Paket (dasar)</p>
            <p className="text-[11px] text-admin-muted/70 mt-0.5">Komponen + tiap bagian yang modenya &quot;Included&quot; saja — ini yang tampil di katalog publik.</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
              <span className="text-[13px] text-admin-ink">Komponen Biaya</span>
              <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.componentsTotalSellPrice)}</span>
            </div>
            {breakdown.hotelMakkahMode === 'included' && breakdown.hotelMakkah && (
              <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
                <span className="text-[13px] text-admin-ink">Hotel Makkah — {breakdown.hotelMakkah.hotelName} ({breakdown.hotelMakkah.roomTypeName})</span>
                <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.hotelMakkah.totalPrice)}</span>
              </div>
            )}
            {breakdown.hotelMadinahMode === 'included' && breakdown.hotelMadinah && (
              <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
                <span className="text-[13px] text-admin-ink">Hotel Madinah — {breakdown.hotelMadinah.hotelName} ({breakdown.hotelMadinah.roomTypeName})</span>
                <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.hotelMadinah.totalPrice)}</span>
              </div>
            )}
            {breakdown.transportMode === 'included' && breakdown.includedTransportPrice != null && (
              <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
                <span className="text-[13px] text-admin-ink">Kendaraan — {breakdown.includedVehicleName}</span>
                <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.includedTransportPrice)}</span>
              </div>
            )}
            {breakdown.muthowifMode === 'included' && breakdown.includedMuthowifPrice != null && (
              <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
                <span className="text-[13px] text-admin-ink">Muthowif</span>
                <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.includedMuthowifPrice)}</span>
              </div>
            )}
            {breakdown.visaMode === 'included' && breakdown.includedVisaPrice != null && (
              <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
                <span className="text-[13px] text-admin-ink">Visa — {breakdown.includedVisaName}</span>
                <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.includedVisaPrice)}</span>
              </div>
            )}
            {breakdown.flightMode === 'included' && breakdown.includedFlightPrice != null && (
              <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
                <span className="text-[13px] text-admin-ink">Tiket Pesawat — {breakdown.includedFlightLabel}</span>
                <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.includedFlightPrice)}</span>
              </div>
            )}
            {breakdown.cateringMode === 'included' && breakdown.includedCateringPrice != null && (
              <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
                <span className="text-[13px] text-admin-ink">Katering — {breakdown.includedCateringName}</span>
                <span className="text-[13px] font-medium text-admin-ink">{rupiah(breakdown.includedCateringPrice)}</span>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg px-4 py-2 border-t border-admin-line">
              <span className="text-[13px] font-bold text-admin-ink">Harga Jual Paket</span>
              <span className="text-[15px] font-bold text-admin-accent-strong">
                {rupiah(
                  breakdown.componentsTotalSellPrice
                  + (breakdown.hotelMakkahMode === 'included' && breakdown.hotelMakkah ? breakdown.hotelMakkah.totalPrice : 0)
                  + (breakdown.hotelMadinahMode === 'included' && breakdown.hotelMadinah ? breakdown.hotelMadinah.totalPrice : 0)
                  + (breakdown.transportMode === 'included' ? (breakdown.includedTransportPrice ?? 0) : 0)
                  + (breakdown.muthowifMode === 'included' ? (breakdown.includedMuthowifPrice ?? 0) : 0)
                  + (breakdown.visaMode === 'included' ? (breakdown.includedVisaPrice ?? 0) : 0)
                  + (breakdown.flightMode === 'included' ? (breakdown.includedFlightPrice ?? 0) : 0)
                  + (breakdown.cateringMode === 'included' ? (breakdown.includedCateringPrice ?? 0) : 0)
                )}
              </span>
            </div>
          </div>

          {(breakdown.vehicleOptions.length > 0 || breakdown.hotelMakkahOptions.length > 0 || breakdown.hotelMadinahOptions.length > 0
            || breakdown.visaOptions.length > 0 || breakdown.flightOptions.length > 0 || breakdown.cateringOptions.length > 0
            || breakdown.muthowifMode === 'user_choice') && (
            <div>
              <p className="text-sm font-semibold text-admin-ink">Opsi Tambahan (dipilih pilgrim saat booking)</p>
              <p className="text-[11px] text-admin-muted/70 mt-0.5 mb-2">Harga di bawah ini TIDAK dijumlah ke Harga Jual Paket — baru ditambahkan kalau pilgrim benar-benar memilihnya.</p>
              <div className="space-y-1.5">
                {breakdown.hotelMakkahOptions.map(o => (
                  <div key={o.hotelRoomScheduleId} className="flex items-center justify-between rounded-lg bg-admin-warning/10 px-4 py-2">
                    <span className="text-[13px] text-admin-ink">Hotel Makkah — {o.hotelName} ({o.roomTypeName}, {o.nights} mlm)</span>
                    <span className="text-[13px] font-medium text-admin-warning">+{rupiah(o.pricePerNight)}/kamar/malam</span>
                  </div>
                ))}
                {breakdown.hotelMadinahOptions.map(o => (
                  <div key={o.hotelRoomScheduleId} className="flex items-center justify-between rounded-lg bg-admin-warning/10 px-4 py-2">
                    <span className="text-[13px] text-admin-ink">Hotel Madinah — {o.hotelName} ({o.roomTypeName}, {o.nights} mlm)</span>
                    <span className="text-[13px] font-medium text-admin-warning">+{rupiah(o.pricePerNight)}/kamar/malam</span>
                  </div>
                ))}
                {breakdown.vehicleOptions.map(v => (
                  <div key={v.transportPricingId} className="flex items-center justify-between rounded-lg bg-admin-warning/10 px-4 py-2">
                    <span className="text-[13px] text-admin-ink">Kendaraan — {v.vehicleName}</span>
                    <span className="text-[13px] font-medium text-admin-warning">+{rupiah(v.vehiclePrice)}</span>
                  </div>
                ))}
                {breakdown.muthowifMode === 'user_choice' && breakdown.currentMuthowifPrice != null && (
                  <div className="flex items-center justify-between rounded-lg bg-admin-warning/10 px-4 py-2">
                    <span className="text-[13px] text-admin-ink">Muthowif</span>
                    <span className="text-[13px] font-medium text-admin-warning">+{rupiah(breakdown.currentMuthowifPrice)}</span>
                  </div>
                )}
                {breakdown.visaOptions.map(v => (
                  <div key={v.visaProductId} className="flex items-center justify-between rounded-lg bg-admin-warning/10 px-4 py-2">
                    <span className="text-[13px] text-admin-ink">Visa — {v.name}</span>
                    <span className="text-[13px] font-medium text-admin-warning">+{rupiah(v.price)}</span>
                  </div>
                ))}
                {breakdown.flightOptions.map(f => (
                  <div key={f.flightScheduleId} className="flex items-center justify-between rounded-lg bg-admin-warning/10 px-4 py-2">
                    <span className="text-[13px] text-admin-ink">Tiket Pesawat — {f.label}</span>
                    <span className="text-[13px] font-medium text-admin-warning">+{rupiah(f.price)}</span>
                  </div>
                ))}
                {breakdown.cateringOptions.map(c => (
                  <div key={c.cateringOptionId} className="flex items-center justify-between rounded-lg bg-admin-warning/10 px-4 py-2">
                    <span className="text-[13px] text-admin-ink">Katering — {c.name} ({c.numPeople} orang × {c.numDays} hari)</span>
                    <span className="text-[13px] font-medium text-admin-warning">+{rupiah(c.price)}</span>
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
