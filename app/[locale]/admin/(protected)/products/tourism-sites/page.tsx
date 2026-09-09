'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Pencil, MapPin } from 'lucide-react'

type TourismSite = { id: string; name: string; city: string | null; isActive: boolean }

export default function TourismSitesPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }

  const [list, setList] = useState<TourismSite[]>([])
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', city: 'makkah', description: '', gmapsUrl: '' })

  async function load() {
    const r = await fetch('/api/v1/admin/products/tourism-sites')
    const j = await r.json()
    setList(j.data ?? [])
  }
  useEffect(() => { load() }, [])

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/v1/admin/products/tourism-sites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    await load(); setShow(false); setSaving(false)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="admin-h1 flex items-center gap-2"><MapPin className="h-5 w-5 text-teal-600" /> Situs Wisata</h1>
          <p className="text-sm text-slate-500 mt-1">Master data tempat wisata — dipakai berulang di berbagai Paket Ziarah.</p>
        </div>
        <button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</button>
      </div>

      {show && (
        <div className="admin-form-panel space-y-3">
          <p className="text-sm font-semibold text-ink">Situs Baru</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <p className="text-xs text-slate-500 mb-1">Nama</p>
              <input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Jabal Nur (Gua Hira)" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Kota</p>
              <select className="admin-select" value={form.city} onChange={set('city')}>
                <option value="makkah">Makkah</option>
                <option value="madinah">Madinah</option>
                <option value="jeddah">Jeddah</option>
              </select>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Link Google Maps (opsional)</p>
              <input className="admin-inp" value={form.gmapsUrl} onChange={set('gmapsUrl')} placeholder="https://maps.google.com/..." />
            </div>
            <div className="md:col-span-2">
              <p className="text-xs text-slate-500 mb-1">Deskripsi</p>
              <textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50">{saving ? '...' : 'Simpan'}</button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60"><tr>
            <th className="admin-th">Nama</th>
            <th className="admin-th">Kota</th>
            <th className="admin-th">Status</th>
            <th className="admin-th"></th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {list.map(s => (
              <tr key={s.id} className={`hover:bg-canvas/40 transition-colors ${!s.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 text-ink font-medium text-[13px]">{s.name}</td>
                <td className="px-4 py-3 text-slate-500 capitalize text-[12px]">{s.city}</td>
                <td className="px-4 py-3">
                  <span className={s.isActive ? 'admin-badge-green' : 'admin-badge-gray'}>{s.isActive ? 'Aktif' : 'Nonaktif'}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => router.push(`/${locale}/admin/products/tourism-sites/${s.id}`)}
                    className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-ink transition-colors">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-sm">Belum ada situs wisata.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
