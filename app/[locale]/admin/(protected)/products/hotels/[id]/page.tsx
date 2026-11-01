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
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeriodForm, type RoomType } from './PeriodForm'
import { PeriodRow, type Period } from './PeriodRow'

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
        description="Satu periode tanggal bisa punya harga berbeda untuk banyak tipe kamar sekaligus — sama seperti rate sheet dari vendor. Edit dan Duplikat membuka tanggal beserta seluruh isinya."
        aside={<button onClick={() => setShowPeriodForm(!showPeriodForm)} className="admin-btn-sm flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Tambah Periode</button>}
      >

        {showPeriodForm && (
          <div className="overflow-hidden rounded-xl border border-admin-line">
            <PeriodForm
              mode="create" hotelId={hotel.id} roomTypes={roomTypes} ask={ask}
              onCancel={() => setShowPeriodForm(false)}
              onDone={async newId => { await loadPeriods(); setShowPeriodForm(false); setExpandedPeriodId(newId) }}
            />
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
