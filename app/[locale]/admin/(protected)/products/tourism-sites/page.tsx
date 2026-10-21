'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Pencil, MapPin } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type TourismSite = { id: string; name: string; city: string | null; isActive: boolean }

export default function TourismSitesPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }

  const [list, setList] = useState<TourismSite[]>([])
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', city: 'makkah', description: '', gmapsUrl: '' })

  async function load() {
    const r = await fetch('/api/v1/admin/products/tourism-sites')
    const j = await r.json()
    setList(j.data ?? [])
    setLoading(false)
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

  const columns: Column<TourismSite>[] = [
    { key: 'name', header: 'Nama', mobile: 'title', cell: s => <span className="text-[13px] font-medium">{s.name}</span> },
    { key: 'city', header: 'Kota', cell: s => <span className="text-[12px] capitalize text-admin-muted">{s.city}</span> },
    { key: 'status', header: 'Status', cell: s => <Badge tone={s.isActive ? 'ok' : 'neutral'}>{s.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: s => (
        <button onClick={() => router.push(`/${locale}/admin/products/tourism-sites/${s.id}`)}
          className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MapPin}
        title="Situs Wisata"
        description="Master data tempat wisata — dipakai berulang di berbagai Paket Ziarah."
        actions={<button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</button>}
      />

      {show && (
        <div className="admin-form-panel space-y-3">
          <p className="text-sm font-semibold text-admin-ink">Situs Baru</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <p className="text-xs text-admin-muted mb-1">Nama</p>
              <input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Jabal Nur (Gua Hira)" />
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Kota</p>
              <select className="admin-select" value={form.city} onChange={set('city')}>
                <option value="makkah">Makkah</option>
                <option value="madinah">Madinah</option>
                <option value="jeddah">Jeddah</option>
              </select>
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Link Google Maps (opsional)</p>
              <input className="admin-inp" value={form.gmapsUrl} onChange={set('gmapsUrl')} placeholder="https://maps.google.com/..." />
            </div>
            <div className="md:col-span-2">
              <p className="text-xs text-admin-muted mb-1">Deskripsi</p>
              <textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50">{saving ? '...' : 'Simpan'}</button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <DataTable columns={columns} rows={list} getRowId={s => s.id} loading={loading} empty="Belum ada situs wisata." rowClassName={s => (s.isActive ? undefined : 'opacity-50')} />
    </div>
  )
}
