'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Images } from 'lucide-react'
import { formatDistance } from '@/lib/utils'
import { HOTEL_FACILITIES } from '@/lib/constants/hotelFacilities'

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
  const [form, setForm] = useState({
    name: '', city: 'makkah', stars: 4, distanceToHaramM: 500, description: '',
    facilities: [] as string[],
  })

  async function load() {
    const r = await fetch('/api/v1/admin/products/hotels')
    const j = await r.json()
    setHotels(j.data ?? [])
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

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="admin-h1">Hotel</h1>
        <button onClick={() => setShowForm(!showForm)} className="admin-btn">
          <Plus className="h-4 w-4" /> Tambah Hotel
        </button>
      </div>

      {showForm && (
        <div className="admin-form-panel space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink">Hotel Baru</p>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Isi data dasar dulu — foto, fasilitas detail & jadwal kamar dapat diatur setelah simpan.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">Nama Hotel</p>
              <input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Nama lengkap hotel" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Kota</p>
              <select className="admin-select" value={form.city} onChange={set('city')}>
                <option value="makkah">Makkah</option>
                <option value="madinah">Madinah</option>
              </select>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Bintang</p>
              <input type="number" min={1} max={5} className="admin-inp" value={form.stars} onChange={set('stars')} />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Jarak ke Haram (meter)</p>
              <input type="number" className="admin-inp" value={form.distanceToHaramM} onChange={set('distanceToHaramM')} />
            </div>
            <div className="md:col-span-2">
              <p className="text-xs text-slate-500 mb-1">Deskripsi</p>
              <textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} />
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-2">Fasilitas</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {HOTEL_FACILITIES.map(f => (
                <label key={f.code} className="flex items-center gap-2 text-[13px] text-ink2 cursor-pointer">
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

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60">
            <tr>
              <th className="admin-th">Nama</th>
              <th className="admin-th">Kota</th>
              <th className="admin-th hidden md:table-cell">Jarak</th>
              <th className="admin-th">Periode</th>
              <th className="admin-th">Status</th>
              <th className="admin-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {hotels.map(h => (
              <tr key={h.id} className={`hover:bg-canvas/40 transition-colors ${!h.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-medium text-ink text-[13px]">
                  {h.name}
                  <span className="ml-2 text-gold-600 text-[11px]">{'★'.repeat(h.stars ?? 0)}</span>
                </td>
                <td className="px-4 py-3 text-slate-500 capitalize text-[12px]">{h.city}</td>
                <td className="px-4 py-3 text-slate-500 hidden md:table-cell text-[12px]">
                  {h.distanceToHaramM ? formatDistance(h.distanceToHaramM) : '-'}
                </td>
                <td className="px-4 py-3 text-slate-500 text-[12px]">{h._count.pricePeriods} periode</td>
                <td className="px-4 py-3">
                  <span className={h.isActive ? 'admin-badge-green' : 'admin-badge-gray'}>
                    {h.isActive ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <a
                      href={`/${locale}/admin/products/hotels/${h.id}`}
                      className="h-7 px-2.5 rounded-lg border border-line text-[11px] font-medium text-ink2 hover:bg-canvas flex items-center gap-1 transition-colors"
                      title="Edit hotel & kelola foto"
                    >
                      <Images className="h-3 w-3" /> Kelola
                    </a>
                    <button
                      onClick={() => toggleActive(h.id, h.isActive)}
                      className="admin-btn-ghost text-[11px] px-2 py-1"
                    >
                      {h.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {hotels.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">
                  Belum ada hotel. Klik &quot;Tambah Hotel&quot; untuk mulai.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
