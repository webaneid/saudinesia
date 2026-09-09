'use client'

import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'

type Catering = { id: string; name: string; boardType: string; menuStyle: string; pricePerPersonRegular: number }

export default function CateringPage() {
  const [list,   setList]   = useState<Catering[]>([])
  const [show,   setShow]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', boardType: 'full_board', menuStyle: 'asian', pricePerPersonRegular: 150000, pricePerPersonRamadan: 200000, pricePerPersonHajj: 250000 })

  async function load() { const r = await fetch('/api/v1/admin/products/catering'); const j = await r.json(); setList(j.data ?? []) }
  useEffect(() => { load() }, [])

  function set(k: string) { return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value })) }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/v1/admin/products/catering', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, pricePerPersonRegular: +form.pricePerPersonRegular, pricePerPersonRamadan: +form.pricePerPersonRamadan, pricePerPersonHajj: +form.pricePerPersonHajj }) })
    await load(); setShow(false); setSaving(false)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="admin-h1">Paket Katering</h1>
        <button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</button>
      </div>
      {show && (
        <div className="admin-form-panel">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><p className="text-xs text-slate-500 mb-1">Nama Paket</p><input className="admin-inp" value={form.name} onChange={set('name')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Board Type</p>
              <select className="admin-select" value={form.boardType} onChange={set('boardType')}>
                <option value="full_board">Full Board</option><option value="half_board">Half Board</option>
              </select>
            </div>
            <div><p className="text-xs text-slate-500 mb-1">Menu</p>
              <select className="admin-select" value={form.menuStyle} onChange={set('menuStyle')}>
                <option value="asian">Asia</option><option value="arabic">Arab</option><option value="western">Barat</option>
              </select>
            </div>
            <div><p className="text-xs text-slate-500 mb-1">Harga/org/hari Regular</p><input type="number" className="admin-inp" value={form.pricePerPersonRegular} onChange={set('pricePerPersonRegular')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Harga/org/hari Ramadan</p><input type="number" className="admin-inp" value={form.pricePerPersonRamadan} onChange={set('pricePerPersonRamadan')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Harga/org/hari Haji</p><input type="number" className="admin-inp" value={form.pricePerPersonHajj} onChange={set('pricePerPersonHajj')} /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50">{saving ? '...' : 'Simpan'}</button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}
      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60"><tr><th className="admin-th">Nama</th><th className="admin-th">Tipe</th><th className="admin-th text-right">Harga Regular</th></tr></thead>
          <tbody className="divide-y divide-line">
            {list.map(c => (
              <tr key={c.id} className="hover:bg-canvas/40 transition-colors">
                <td className="px-4 py-3 text-ink font-medium text-[13px]">{c.name}</td>
                <td className="px-4 py-3 text-slate-500 text-[12px]">{c.boardType} · {c.menuStyle}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[12px] text-ink2">{formatRupiah(c.pricePerPersonRegular)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
