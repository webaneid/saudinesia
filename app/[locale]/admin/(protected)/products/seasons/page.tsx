'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'

type Season = { id: string; name: string; startDate: string; endDate: string }
const LABELS: Record<string, string> = { regular: 'Regular', ramadan: 'Ramadan', hajj: 'Haji' }

export default function SeasonsPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [show,    setShow]    = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [form, setForm] = useState({ name: 'ramadan', startDate: '', endDate: '' })

  async function load() { const r = await fetch('/api/v1/admin/products/seasons'); const j = await r.json(); setSeasons(j.data ?? []) }
  useEffect(() => { load() }, [])

  function set(k: string) { return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value })) }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/v1/admin/products/seasons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    await load(); setShow(false); setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus musim ini?')) return
    await fetch(`/api/v1/admin/products/seasons/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="admin-h1">Manajemen Musim</h1>
        <button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Musim</button>
      </div>
      <p className="text-sm text-slate-500">Musim menentukan tier harga yang berlaku. Tanggal di luar range Ramadan/Haji otomatis dianggap Regular.</p>

      {show && (
        <div className="admin-form-panel">
          <div className="grid md:grid-cols-3 gap-3">
            <div><p className="text-xs text-slate-500 mb-1">Musim</p>
              <select className="admin-select" value={form.name} onChange={set('name')}>
                <option value="ramadan">Ramadan</option><option value="hajj">Haji</option><option value="regular">Regular</option>
              </select>
            </div>
            <div><p className="text-xs text-slate-500 mb-1">Mulai</p><input type="date" className="admin-inp" value={form.startDate} onChange={set('startDate')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Selesai</p><input type="date" className="admin-inp" value={form.endDate} onChange={set('endDate')} /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.startDate || !form.endDate} className="admin-btn-sm disabled:opacity-50">{saving ? '...' : 'Simpan'}</button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60"><tr><th className="admin-th">Musim</th><th className="admin-th">Mulai</th><th className="admin-th">Selesai</th><th className="admin-th"></th></tr></thead>
          <tbody className="divide-y divide-line">
            {seasons.map(s => (
              <tr key={s.id} className="hover:bg-canvas/40 transition-colors">
                <td className="px-4 py-3">
                  <span className={s.name === 'hajj' ? 'admin-badge-amber' : s.name === 'ramadan' ? 'admin-badge-blue' : 'admin-badge-gray'}>
                    {LABELS[s.name] ?? s.name}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink2 text-[12px] tabular-nums">{s.startDate.slice(0, 10)}</td>
                <td className="px-4 py-3 text-ink2 text-[12px] tabular-nums">{s.endDate.slice(0, 10)}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDelete(s.id)} className="text-slate-400 hover:text-rose-600 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
