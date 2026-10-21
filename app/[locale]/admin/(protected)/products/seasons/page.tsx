'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type Season = { id: string; name: string; startDate: string; endDate: string }
const LABELS: Record<string, string> = { regular: 'Regular', ramadan: 'Ramadan', hajj: 'Haji' }

export default function SeasonsPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [show,    setShow]    = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: 'ramadan', startDate: '', endDate: '' })

  async function load() { const r = await fetch('/api/v1/admin/products/seasons'); const j = await r.json(); setSeasons(j.data ?? []); setLoading(false) }
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

  const columns: Column<Season>[] = [
    {
      key: 'name', header: 'Musim', mobile: 'title',
      cell: s => <Badge tone={s.name === 'hajj' ? 'warning' : s.name === 'ramadan' ? 'accent' : 'neutral'}>{LABELS[s.name] ?? s.name}</Badge>,
    },
    { key: 'start', header: 'Mulai', cell: s => <span className="text-[12px] tabular-nums text-admin-ink/80">{s.startDate.slice(0, 10)}</span> },
    { key: 'end', header: 'Selesai', cell: s => <span className="text-[12px] tabular-nums text-admin-ink/80">{s.endDate.slice(0, 10)}</span> },
    {
      key: 'actions', header: '', align: 'right',
      cell: s => (
        <button onClick={() => handleDelete(s.id)} aria-label="Hapus musim" className="text-admin-muted/70 transition-colors hover:text-admin-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Manajemen Musim"
        description="Musim menentukan tier harga yang berlaku. Tanggal di luar range Ramadan/Haji otomatis dianggap Regular."
        actions={<button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Musim</button>}
      />

      {show && (
        <div className="admin-form-panel">
          <div className="grid md:grid-cols-3 gap-3">
            <div><p className="text-xs text-admin-muted mb-1">Musim</p>
              <select className="admin-select" value={form.name} onChange={set('name')}>
                <option value="ramadan">Ramadan</option><option value="hajj">Haji</option><option value="regular">Regular</option>
              </select>
            </div>
            <div><p className="text-xs text-admin-muted mb-1">Mulai</p><input type="date" className="admin-inp" value={form.startDate} onChange={set('startDate')} /></div>
            <div><p className="text-xs text-admin-muted mb-1">Selesai</p><input type="date" className="admin-inp" value={form.endDate} onChange={set('endDate')} /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.startDate || !form.endDate} className="admin-btn-sm disabled:opacity-50">{saving ? '...' : 'Simpan'}</button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <DataTable columns={columns} rows={seasons} getRowId={s => s.id} loading={loading} empty="Belum ada musim." />
    </div>
  )
}
