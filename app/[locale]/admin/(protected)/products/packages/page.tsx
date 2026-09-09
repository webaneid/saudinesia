'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Pencil, Package } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'

type Pkg = { id: string; name: string; price: number; isFeatured: boolean; isActive: boolean }

export default function PackagesPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }

  const [list, setList] = useState<Pkg[]>([])
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })

  async function load() { const r = await fetch('/api/v1/admin/products/packages'); const j = await r.json(); setList(j.data ?? []) }
  useEffect(() => { load() }, [])

  function set(k: string) { return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value })) }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/v1/admin/products/packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    await load(); setShow(false); setSaving(false)
    setForm({ name: '', description: '' })
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="admin-h1 flex items-center gap-2"><Package className="h-5 w-5 text-purple-600" /> Paket Umroh</h1>
          <p className="text-sm text-slate-500 mt-1">Isi info dasar dulu — hotel, kendaraan, muthowif, visa, tiket pesawat, katering, dan komponen biaya dikonfigurasi setelah paket dibuat (klik &quot;Kelola&quot;).</p>
        </div>
        <button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Paket</button>
      </div>

      {show && (
        <div className="admin-form-panel space-y-3">
          <p className="text-sm font-semibold text-ink">Paket Baru</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><p className="text-xs text-slate-500 mb-1">Nama Paket</p><input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Paket Umroh Hemat 9 Hari" /></div>
            <div className="md:col-span-2"><p className="text-xs text-slate-500 mb-1">Deskripsi</p><textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60"><tr>
            <th className="admin-th">Nama Paket</th>
            <th className="admin-th text-right">Harga Jual Paket</th>
            <th className="admin-th">Status</th>
            <th className="admin-th"></th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {list.map(p => (
              <tr key={p.id} className={`hover:bg-canvas/40 transition-colors ${!p.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink text-[13px]">{p.name}</span>
                    {p.isFeatured && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-semibold">Featured</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-[12px] text-ink2">{formatRupiah(p.price)}</td>
                <td className="px-4 py-3"><span className={p.isActive ? 'admin-badge-green' : 'admin-badge-gray'}>{p.isActive ? 'Aktif' : 'Nonaktif'}</span></td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => router.push(`/${locale}/admin/products/packages/${p.id}`)}
                    className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-ink transition-colors">
                    <Pencil className="h-3.5 w-3.5" /> Kelola
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-sm">Belum ada paket umroh.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
