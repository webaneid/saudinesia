'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Pencil, Landmark } from 'lucide-react'

type TourPackage = {
  id: string; name: string; price: string | number; isActive: boolean
  transportMode: 'included' | 'user_choice' | 'none'
  transportTrip: { name: string; origin: string; destination: string } | null
  includedTransportPricing: { vehicle: { name: string } } | null
  _count: { sites: number }
}

export default function TourPackagesPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }

  const [list, setList] = useState<TourPackage[]>([])
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })

  async function load() {
    const r = await fetch('/api/v1/admin/products/tour-packages')
    const j = await r.json()
    setList(j.data ?? [])
  }
  useEffect(() => { load() }, [])

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/v1/admin/products/tour-packages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    await load(); setShow(false); setSaving(false)
    setForm({ name: '', description: '' })
  }

  function formatPrice(p: string | number) {
    const n = Number(p)
    return n > 0 ? `Rp ${n.toLocaleString('id-ID')}` : '—'
  }

  function transportLabel(p: TourPackage) {
    if (p.transportMode === 'included' && p.includedTransportPricing) return `${p.includedTransportPricing.vehicle.name} (included)`
    if (p.transportMode === 'user_choice' && p.transportTrip) return `${p.transportTrip.origin} → ${p.transportTrip.destination} (user choice)`
    return '— tanpa kendaraan —'
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="admin-h1 flex items-center gap-2"><Landmark className="h-5 w-5 text-teal-600" /> Paket Ziarah</h1>
          <p className="text-sm text-slate-500 mt-1">Paket wisata ziarah — kendaraan &amp; hotel dikonfigurasi di halaman Kelola setelah paket dibuat.</p>
        </div>
        <button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</button>
      </div>

      {show && (
        <div className="admin-form-panel space-y-3">
          <p className="text-sm font-semibold text-ink">Paket Baru</p>
          <p className="text-[11px] text-slate-400">Isi info dasar dulu — kendaraan, hotel, situs, dan komponen biaya dikonfigurasi setelah paket dibuat (klik &quot;Kelola&quot;).</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <p className="text-xs text-slate-500 mb-1">Nama Paket</p>
              <input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Ziarah Makkah — Sejarah Islam" />
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
            <th className="admin-th">Nama Paket</th>
            <th className="admin-th">Kendaraan</th>
            <th className="admin-th">Situs</th>
            <th className="admin-th">Harga Jual Paket</th>
            <th className="admin-th">Status</th>
            <th className="admin-th"></th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {list.map(p => (
              <tr key={p.id} className={`hover:bg-canvas/40 transition-colors ${!p.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 text-ink font-medium text-[13px]">{p.name}</td>
                <td className="px-4 py-3 text-slate-500 text-[12px]">{transportLabel(p)}</td>
                <td className="px-4 py-3 text-slate-500 text-[12px]">{p._count.sites} situs</td>
                <td className="px-4 py-3 text-slate-700 text-[12px] font-medium">{formatPrice(p.price)}</td>
                <td className="px-4 py-3">
                  <span className={p.isActive ? 'admin-badge-green' : 'admin-badge-gray'}>{p.isActive ? 'Aktif' : 'Nonaktif'}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => router.push(`/${locale}/admin/products/tour-packages/${p.id}`)}
                    className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-ink transition-colors">
                    <Pencil className="h-3.5 w-3.5" /> Kelola
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">Belum ada paket ziarah.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
