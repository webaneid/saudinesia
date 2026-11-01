'use client'

import { useState, useEffect } from 'react'
import { Plus, Save, Wallet, Trash2, Pencil, Building2, ConciergeBell, MapPin, ListChecks } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { useParams } from 'next/navigation'
import { MediaField } from '@/components/admin/media/MediaField'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { PublishBox } from '@/components/admin/editor/PublishBox'
import { useUnsavedGuard } from '@/components/admin/editor/useUnsavedGuard'
import { DeleteBox } from '@/components/admin/editor/DeleteBox'
import { useDeleteEntity } from '@/components/admin/editor/useDeleteEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { HOTEL_FACILITIES } from '@/lib/constants/hotelFacilities'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { VendorPicker } from '@/components/admin/vendor/VendorPicker'
import { PriceCard } from '@/components/admin/pricing/PriceCard'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { CurrencySelect } from '@/components/shared/CurrencySelect'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { DATE_SHORT_MONTH, addDays, daysBetween, formatCalendarDate, type CalendarDate } from '@/lib/time'
import { KindButton } from '@/components/shared/data-table/RowActions'

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
  return formatCalendarDate(d, DATE_SHORT_MONTH)
}

export default function HotelDetailPage() {
  const { ask, dialog } = useConfirm()
  const { id, locale } = useParams() as { id: string; locale: string }

  const [hotel, setHotel] = useState<Hotel | null>(null)
  const [form, setForm] = useState({
    name: '', city: 'makkah', stars: 4, distanceToHaramM: 500, description: '',
    facilities: [] as string[], isActive: true,
  })
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Dilacak: info hotel (form + alamat). Periode/layanan/tipe kamar tersimpan langsung per aksi, bukan lewat tombol Simpan.
  const { dirty, markClean, patchClean } = useDirtyForm(hotel ? { form, address } : null)
  useUnsavedGuard(dirty)
  const del = useDeleteEntity(`/api/v1/admin/products/hotels/${id}`, `/${locale}/admin/products/hotels`)
  async function handleDelete() {
    if (await del.run() === 'deactivated') { setForm(f => ({ ...f, isActive: false })); patchClean(prev => ({ ...prev, form: { ...prev.form, isActive: false } })) }
  }

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
      const f = {
        name: h.name, city: h.city, stars: h.stars ?? 4,
        distanceToHaramM: h.distanceToHaramM ?? 0, description: h.description ?? '',
        facilities: Array.isArray(h.facilities) ? h.facilities : [], isActive: h.isActive,
      }
      const a = toAddressValue(h.address)
      setForm(f); setAddress(a); markClean({ form: f, address: a })
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
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/v1/admin/products/hotels/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form, stars: +form.stars, distanceToHaramM: +form.distanceToHaramM,
          ...(address.fullAddress.trim() ? { address } : {}),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        setError(j?.error ?? 'Perubahan gagal disimpan.')
        return
      }
      await loadHotel()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setSaving(false)
    }
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
    if (!(await ask({ title: 'Hapus layanan ini?', body: 'Layanan tambahan hotel ini dihapus dari daftar.' }))) return
    await fetch(`/api/v1/admin/products/hotels/${id}/services/${serviceId}`, { method: 'DELETE' })
    await loadServices()
  }

  if (!hotel) {
    return <div className="flex items-center justify-center py-20 text-admin-muted/70 text-sm">Memuat data hotel…</div>
  }

  return (
    <>
    {dialog}
    <EditorShell
      backHref={`/${locale}/admin/products/hotels`}
      backLabel="Daftar Hotel"
      banner={
        (error || del.error || del.notice) ? (
          <p role={del.notice && !error && !del.error ? 'status' : 'alert'} className={`m-0 rounded-xl px-3 py-2 text-sm font-medium ${del.notice && !error && !del.error ? 'border border-admin-line bg-admin-spot text-admin-ink' : 'bg-admin-danger/10 text-admin-danger'}`}>{error ?? del.error ?? del.notice}</p>
        ) : undefined
      }
      title={
        <div className="space-y-3">
          <label htmlFor="hotel-name" className="sr-only">Nama hotel</label>
          <input id="hotel-name" className="admin-inp text-lg font-semibold" placeholder="Nama hotel" value={form.name} onChange={set('name')} />
          <RichTextEditor id="hotel-description" title="Deskripsi hotel" value={form.description} onChange={description => setForm(p => ({ ...p, description }))} placeholder="Tentang hotel, lokasi, fasilitas unggulan, catatan untuk jamaah…" />
        </div>
      }
      sidebar={
        <>
          <PublishBox
            active={form.isActive}
            onActiveChange={isActive => setForm(p => ({ ...p, isActive }))}
            hint="Tombol ini menyimpan info hotel (nama, deskripsi, kota, fasilitas, alamat, status). Periode, harga kamar, dan layanan tersimpan langsung saat diubah."
            onSave={handleSave} saving={saving} dirty={dirty} saved={saved} canSave={!!form.name.trim()}
          />
          <MetaBox title="Galeri Hotel" icon={Building2} collapsible={false}>
            <MediaField productType="hotel" productId={hotel.id} label="Foto Hotel" />
          </MetaBox>
          <MetaBox title="Atribut" icon={ListChecks} collapsible={false}>
            <div>
              <label htmlFor="hotel-city" className="mb-1 block text-xs text-admin-muted">Kota</label>
              <ChoiceSelect ariaLabel="Kota" value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} clearable={false} options={[{ id: 'makkah', label: 'Makkah' }, { id: 'madinah', label: 'Madinah' }]} />
            </div>
            <div>
              <label htmlFor="hotel-stars" className="mb-1 block text-xs text-admin-muted">Bintang</label>
              <input id="hotel-stars" type="number" min={1} max={5} className="admin-inp" value={form.stars} onChange={set('stars')} />
            </div>
            <div>
              <label htmlFor="hotel-distance" className="mb-1 block text-xs text-admin-muted">Jarak ke Haram (meter)</label>
              <input id="hotel-distance" type="number" className="admin-inp" value={form.distanceToHaramM} onChange={set('distanceToHaramM')} />
            </div>
          </MetaBox>
          <DeleteBox
            confirmText="Hapus hotel ini beserta periode, harga kamar, layanan, dan alamatnya? Bila sudah dipakai booking atau paket, ia hanya dinonaktifkan (bisa diaktifkan kembali)."
            onDelete={handleDelete} deleting={del.deleting}
          />
        </>
      }
      mobileBar={
        <button type="button" onClick={() => void handleSave()} disabled={saving || !dirty || !form.name.trim()} className="admin-btn w-full disabled:opacity-50">
          {saving ? 'Menyimpan…' : saved ? 'Tersimpan ✓' : dirty ? 'Simpan perubahan' : 'Tidak ada perubahan'}
        </button>
      }
      main={
        <>
      <MetaBox title="Fasilitas" icon={ListChecks}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {HOTEL_FACILITIES.map(f => (
            <label key={f.code} className="flex cursor-pointer items-center gap-2 text-[13px] text-admin-ink/80">
              <input type="checkbox" className="h-3.5 w-3.5" checked={form.facilities.includes(f.code)} onChange={() => toggleFacility(f.code)} />
              {f.label}
            </label>
          ))}
        </div>
      </MetaBox>

      <MetaBox title="Alamat" icon={MapPin} description="docs/arsitektur-alamat.md" defaultOpen={!!address.fullAddress.trim()}>
        <AddressPicker value={address} onChange={setAddress} />
      </MetaBox>

      {/* Periode & Harga Kamar */}
      <MetaBox
        title="Periode & Harga Kamar" icon={Wallet}
        description="Satu periode tanggal bisa punya harga berbeda untuk banyak tipe kamar sekaligus — sama seperti rate sheet dari vendor."
        aside={<button onClick={() => setShowPeriodForm(!showPeriodForm)} className="admin-btn-sm flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Tambah Periode</button>}
      >

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
              ask={ask}
              onDuplicated={async newId => { await loadPeriods(); setExpandedPeriodId(newId) }}
            />
          ))}
        </div>
      </MetaBox>

      {/* Layanan Hotel — menutup Gap #3 (docs/arsitektur-hotel.md §8): dulu tidak ada jalur admin */}
      <MetaBox
        title="Layanan Hotel" icon={ConciergeBell}
        description="Layanan tambahan (mis. airport pickup, laundry) yang tampil di halaman publik hotel ini."
        aside={<button onClick={() => openServiceForm()} className="admin-btn-sm flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Tambah Layanan</button>}
      >

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
      </MetaBox>
        </>
      }
    />
    </>
  )
}

type RoomPriceInput = { hargaKamar: string; totalQuota: string; preview: { hppRupiah: number; sellPrice: number } | null }

/** Tanggal bawaan duplikat: mulai sehari setelah periode sumber berakhir, panjang sama (admin bisa ubah). */
function nextRange(start: string, end: string): { periodStart: string; periodEnd: string } {
  const from = addDays(end as CalendarDate, 1)
  return { periodStart: from, periodEnd: addDays(from, daysBetween(start as CalendarDate, end as CalendarDate)) }
}

type Ask = ReturnType<typeof useConfirm>['ask']
type Notice = { tone: 'ok' | 'error'; text: string } | null

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    const j = await r.json().catch(() => null)
    return r.ok ? { ok: true, data: j?.data } : { ok: false, error: j?.error ?? 'Permintaan gagal.' }
  } catch { return { ok: false, error: 'Tidak dapat menghubungi server.' } }
}

function PeriodRow({ period, hotelId, roomTypes, expanded, onToggle, onSaved, ask, onDuplicated }: {
  period: Period; hotelId: string; roomTypes: RoomType[]
  expanded: boolean; onToggle: () => void; onSaved: () => void
  ask: Ask; onDuplicated: (newId: string) => void
}) {
  const base = `/api/v1/admin/products/hotels/${hotelId}/periods/${period.id}`
  const [mode, setMode] = useState<'view' | 'edit' | 'duplicate'>('view')
  const [dates, setDates] = useState({ periodStart: period.periodStart.slice(0, 10), periodEnd: period.periodEnd.slice(0, 10) })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const startEdit = () => { setDates({ periodStart: period.periodStart.slice(0, 10), periodEnd: period.periodEnd.slice(0, 10) }); setNotice(null); setMode('edit') }
  const startDuplicate = () => { setDates(nextRange(period.periodStart.slice(0, 10), period.periodEnd.slice(0, 10))); setNotice(null); setMode('duplicate') }

  async function submitDates() {
    setBusy(true); setNotice(null)
    const r = mode === 'edit' ? await send(base, 'PUT', dates) : await send(`${base}/duplicate`, 'POST', dates)
    setBusy(false)
    if (!r.ok) { setNotice({ tone: 'error', text: r.error ?? 'Gagal.' }); return }
    setMode('view')
    if (mode === 'duplicate') onDuplicated((r.data as { id: string }).id)
    else { setLoaded(false); await onSaved() }
  }
  async function setActive(isActive: boolean) {
    setBusy(true); setNotice(null)
    const r = await send(base, 'PUT', { isActive })
    setBusy(false)
    if (!r.ok) setNotice({ tone: 'error', text: r.error ?? 'Gagal.' }); else await onSaved()
  }
  async function remove() {
    if (!(await ask({ title: `Hapus periode ${formatDate(period.periodStart)} – ${formatDate(period.periodEnd)}?`, body: 'Harga semua tipe kamar di periode ini ikut terhapus. Bila periode sudah dipakai booking atau paket, periode dinonaktifkan, bukan dihapus.' }))) return
    setBusy(true); setNotice(null)
    const r = await send(base, 'DELETE')
    setBusy(false)
    if (!r.ok) { setNotice({ tone: 'error', text: r.error ?? 'Gagal menghapus.' }); return }
    const d = r.data as { deleted: boolean; message?: string }
    if (!d.deleted) setNotice({ tone: 'ok', text: d.message ?? 'Dinonaktifkan.' })
    await onSaved()
  }
  async function removeRoom(scheduleId: string, name: string) {
    if (!(await ask({ title: `Hapus tipe kamar ${name} dari periode ini?`, body: 'Bila kamar ini sudah dipakai booking atau paket, kamar dinonaktifkan, bukan dihapus.' }))) return
    const r = await send(`${base}/rooms/${scheduleId}`, 'DELETE')
    if (!r.ok) { setNotice({ tone: 'error', text: r.error ?? 'Gagal menghapus.' }); return }
    const d = r.data as { deleted: boolean; message?: string }
    setNotice(d.deleted ? null : { tone: 'ok', text: d.message ?? 'Dinonaktifkan.' })
    await loadPrices(); await onSaved()
  }

  const [vendorId, setVendorId] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [rooms, setRooms] = useState<Record<string, RoomPriceInput>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [schedules, setSchedules] = useState<{ scheduleId: string; roomTypeId: string; roomTypeName: string }[]>([])
  const [priceTick, setPriceTick] = useState(0)
  const [loadSeq, setLoadSeq] = useState(0) // pratinjau HPP/jual dihitung ulang setiap harga dimuat ulang (mis. sesudah ubah tanggal)

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
      setLoadSeq(n => n + 1)
      setSchedules((j.data.rooms as { scheduleId: string; roomTypeId: string; roomTypeName: string }[]).map(r => ({ scheduleId: r.scheduleId, roomTypeId: r.roomTypeId, roomTypeName: r.roomTypeName })))
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
  }, [currency, loadSeq, JSON.stringify(Object.fromEntries(Object.entries(rooms).map(([k, v]) => [k, v.hargaKamar])))])

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
    await loadPrices()
    setPriceTick(t => t + 1)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const prices = period.schedules.filter(s => s.isActive).map(s => s.price)
  const priceRange: { min: number; max: number } | null = prices.length > 0
    ? { min: Math.min(...prices), max: Math.max(...prices) }
    : null

  return (
    <div className="overflow-hidden rounded-xl border border-admin-line">
      <div className="flex items-center gap-2 pr-3">
        <button type="button" onClick={onToggle} aria-expanded={expanded} className={`flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-admin-spot/30 ${period.isActive ? '' : 'opacity-60'}`}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13px] font-semibold text-admin-ink">{formatDate(period.periodStart)} – {formatDate(period.periodEnd)}</span>
            <span className="text-[11px] text-admin-muted">{period.schedules.filter(s => s.isActive).length} tipe kamar terisi</span>
            {!period.isActive && <span className="admin-badge-gray">Nonaktif</span>}
          </span>
          <span className="text-[13px] font-bold text-admin-ink">
            {priceRange
              ? priceRange.min === priceRange.max ? formatRupiah(priceRange.min) : `${formatRupiah(priceRange.min)} – ${formatRupiah(priceRange.max)}`
              : 'Belum ada harga'}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <KindButton kind="edit" label="Ubah tanggal periode" onClick={startEdit} disabled={busy} />
          <KindButton kind="duplicate" label="Duplikat periode" onClick={startDuplicate} disabled={busy} />
          {period.isActive
            ? <KindButton kind="delete" label="Hapus periode" onClick={remove} disabled={busy} />
            : <KindButton kind="activate" label="Aktifkan periode" onClick={() => setActive(true)} disabled={busy} />}
        </div>
      </div>

      {mode !== 'view' && (
        <div className="space-y-2 border-t border-admin-line bg-admin-spot/30 px-4 py-3">
          <p className="m-0 text-xs font-semibold text-admin-ink">
            {mode === 'edit' ? 'Ubah tanggal periode' : `Duplikat periode ${formatDate(period.periodStart)} – ${formatDate(period.periodEnd)}`}
          </p>
          {mode === 'duplicate' && <p className="m-0 text-[11px] text-admin-muted">Tipe kamar, kuota, modal (vendor + mata uang), dan harga jual manual ikut disalin. Tentukan tanggal periode baru.</p>}
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1"><span className="block text-[11px] text-admin-muted">Mulai</span>
              <input type="date" className="admin-inp" aria-label="Tanggal mulai periode" value={dates.periodStart} onChange={e => setDates(d => ({ ...d, periodStart: e.target.value }))} /></label>
            <label className="space-y-1"><span className="block text-[11px] text-admin-muted">Akhir</span>
              <input type="date" className="admin-inp" aria-label="Tanggal akhir periode" min={dates.periodStart} value={dates.periodEnd} onChange={e => setDates(d => ({ ...d, periodEnd: e.target.value }))} /></label>
            <button type="button" onClick={submitDates} disabled={busy || !dates.periodStart || !dates.periodEnd} className="admin-btn-sm flex items-center gap-1.5 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {busy ? 'Menyimpan...' : mode === 'edit' ? 'Simpan tanggal' : 'Buat salinan'}
            </button>
            <button type="button" onClick={() => { setMode('view'); setNotice(null) }} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}
      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`m-0 border-t border-admin-line px-4 py-2 text-[12px] font-medium ${notice.tone === 'error' ? 'text-admin-danger' : 'text-admin-muted'}`}>{notice.text}</p>}
      {expanded && (
        <div className="border-t border-admin-line p-4 space-y-3 bg-admin-spot/20">
          <p className="text-xs font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Vendor &amp; Mata Uang (berlaku untuk semua tipe kamar di periode ini)</p>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <VendorPicker value={vendorId} onChange={setVendorId} context="hotel" label="Vendor hotel" />
            </div>
            <CurrencySelect value={currency} onChange={setCurrency} currencies={CURRENCIES} />
          </div>

          <div className="-mx-1 overflow-x-auto px-1">{/* HP: grid harga digeser ke samping, bukan terpotong */}
          <div className="min-w-max space-y-2">
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
                  {(() => { const sch = schedules.find(x => x.roomTypeId === rt.id); return sch ? <KindButton kind="delete" label={`Hapus tipe kamar ${rt.name} dari periode`} onClick={() => removeRoom(sch.scheduleId, rt.name)} /> : null })()}
                </div>
              )
            })}
          </div>
          </div>

          <button
            onClick={handleSaveAll}
            disabled={saving || !canSave}
            className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Menyimpan...' : saved ? 'Tersimpan' : 'Simpan Semua Harga'}
          </button>
          {saveError && <p role="alert" className="text-[12px] font-medium text-admin-danger">{saveError}</p>}

          {schedules.map(s => (
            <PriceCard key={s.scheduleId} ownerType="hotel" ownerId={s.scheduleId} title={`Harga kamar ${s.roomTypeName}: modal, jual, untung`} reloadKey={priceTick} onChanged={() => { void loadPrices(); void onSaved() }} />
          ))}
        </div>
      )}
    </div>
  )
}
