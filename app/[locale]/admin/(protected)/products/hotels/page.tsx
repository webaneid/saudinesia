'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Images } from 'lucide-react'
import { formatDistance } from '@/lib/utils'
import { HOTEL_FACILITIES } from '@/lib/constants/hotelFacilities'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type Hotel = {
  id: string; name: string; city: string; stars: number | null
  distanceToHaramM: number | null; isActive: boolean; _count: { pricePeriods: number }
}

export default function HotelsPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }
  const [hotels,   setHotels]   = useState<Hotel[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [form, setForm] = useState({
    name: '', city: 'makkah', stars: 4, distanceToHaramM: 500, description: '',
    facilities: [] as string[],
  })

  async function load() {
    const r = await fetch('/api/v1/admin/products/hotels')
    const j = await r.json()
    setHotels(j.data ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

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
    const r = await fetch('/api/v1/admin/products/hotels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, stars: +form.stars, distanceToHaramM: +form.distanceToHaramM }),
    })
    const j = await r.json()
    setSaving(false)
    if (j.success && j.data?.id) {
      router.push(`/${locale}/admin/products/hotels/${j.data.id}`)
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/v1/admin/products/hotels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    await load()
  }

  const columns: Column<Hotel>[] = [
    {
      key: 'name', header: 'Nama', mobile: 'title',
      cell: h => (
        <span className="text-[13px] font-medium">
          {h.name}
          <span className="ml-2 text-[11px] text-admin-gold-strong">{'★'.repeat(h.stars ?? 0)}</span>
        </span>
      ),
    },
    { key: 'city', header: 'Kota', cell: h => <span className="text-[12px] capitalize text-admin-muted">{h.city}</span> },
    {
      key: 'distance', header: 'Jarak', hideBelowLg: true,
      cell: h => <span className="whitespace-nowrap text-[12px] text-admin-muted">{h.distanceToHaramM ? formatDistance(h.distanceToHaramM) : '-'}</span>,
    },
    { key: 'periods', header: 'Periode', cell: h => <span className="whitespace-nowrap text-[12px] text-admin-muted">{h._count.pricePeriods} periode</span> },
    { key: 'status', header: 'Status', cell: h => <Badge tone={h.isActive ? 'ok' : 'neutral'}>{h.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '',
      cell: h => (
        <div className="flex items-center gap-2">
          <a
            href={`/${locale}/admin/products/hotels/${h.id}`}
            className="flex h-7 items-center gap-1 rounded-lg border border-admin-line px-2.5 text-[11px] font-medium text-admin-ink/80 transition-colors hover:bg-admin-spot"
            title="Edit hotel & kelola foto"
          >
            <Images className="h-3 w-3" /> Kelola
          </a>
          <button onClick={() => toggleActive(h.id, h.isActive)} className="admin-btn-ghost px-2 py-1 text-[11px]">
            {h.isActive ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hotel"
        actions={<button onClick={() => setShowForm(!showForm)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Hotel</button>}
      />

      {showForm && (
        <div className="admin-form-panel space-y-4">
          <div>
            <p className="text-sm font-semibold text-admin-ink">Hotel Baru</p>
            <p className="text-[12px] text-admin-muted mt-0.5">
              Isi data dasar dulu — foto, fasilitas detail & jadwal kamar dapat diatur setelah simpan.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-admin-muted mb-1">Nama Hotel</p>
              <input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Nama lengkap hotel" />
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
            <div className="md:col-span-2">
              <p className="text-xs text-admin-muted mb-1">Deskripsi</p>
              <textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} />
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

          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50">
              {saving ? 'Menyimpan...' : 'Simpan & Lanjut →'}
            </button>
            <button onClick={() => setShowForm(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={hotels}
        getRowId={h => h.id}
        loading={loading}
        empty='Belum ada hotel. Klik "Tambah Hotel" untuk mulai.'
        rowClassName={h => (h.isActive ? undefined : 'opacity-50')}
      />
    </div>
  )
}
