'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Pencil, Package } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type Pkg = { id: string; name: string; price: number; isFeatured: boolean; isActive: boolean }

export default function PackagesPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }

  const [list, setList] = useState<Pkg[]>([])
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', description: '' })

  async function load() { const r = await fetch('/api/v1/admin/products/packages'); const j = await r.json(); setList(j.data ?? []); setLoading(false) }
  useEffect(() => { load() }, [])

  function set(k: string) { return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value })) }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/v1/admin/products/packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    await load(); setShow(false); setSaving(false)
    setForm({ name: '', description: '' })
  }

  const columns: Column<Pkg>[] = [
    {
      key: 'name', header: 'Nama Paket', mobile: 'title',
      cell: p => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{p.name}</span>
          {p.isFeatured && <Badge tone="accent">Featured</Badge>}
        </div>
      ),
    },
    { key: 'price', header: 'Harga Jual Paket', align: 'right', cell: p => <span className="text-[12px] font-semibold tabular-nums text-admin-ink/80">{formatRupiah(p.price)}</span> },
    { key: 'status', header: 'Status', cell: p => <Badge tone={p.isActive ? 'ok' : 'neutral'}>{p.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: p => (
        <button onClick={() => router.push(`/${locale}/admin/products/packages/${p.id}`)}
          className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
          <Pencil className="h-3.5 w-3.5" /> Kelola
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Package}
        title="Paket Umroh"
        description='Isi info dasar dulu — hotel, kendaraan, muthowif, visa, tiket pesawat, katering, dan komponen biaya dikonfigurasi setelah paket dibuat (klik "Kelola").'
        actions={<button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Paket</button>}
      />

      {show && (
        <div className="admin-form-panel space-y-3">
          <p className="text-sm font-semibold text-admin-ink">Paket Baru</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><p className="text-xs text-admin-muted mb-1">Nama Paket</p><input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Paket Umroh Hemat 9 Hari" /></div>
            <div className="md:col-span-2"><p className="text-xs text-admin-muted mb-1">Deskripsi</p><textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <DataTable columns={columns} rows={list} getRowId={p => p.id} loading={loading} empty="Belum ada paket umroh." rowClassName={p => (p.isActive ? undefined : 'opacity-50')} />
    </div>
  )
}
