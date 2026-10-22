'use client'

import { useState, useEffect } from 'react'
import { Plus, Star } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

type HajiProduct = { id: string; name: string; hajiType: string; year: number; price: number; totalQuota: number; bookedQuota: number; isActive: boolean }

const HAJI_TYPES = [
  { value: 'furoda',   label: 'Haji Furoda (Musyarifah)' },
  { value: 'khusus',  label: 'Haji Khusus (ONH Plus)' },
  { value: 'reguler', label: 'Haji Reguler' },
  { value: 'plus',    label: 'Haji Plus' },
]

export default function HajiPage() {
  const [list,   setList]   = useState<HajiProduct[]>([])
  const [show,   setShow]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', hajiType: 'furoda', year: new Date().getFullYear() + 1, departureDate: '', returnDate: '', durationDays: 40, price: 150000000, totalQuota: 50, description: '', includes: '' })

  async function load() { const r = await fetch('/api/v1/admin/products/haji'); const j = await r.json(); setList(j.data ?? []); setLoading(false) }
  useEffect(() => { load() }, [])

  function set(k: string) { return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value })) }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/v1/admin/products/haji', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, year: +form.year, durationDays: +form.durationDays, price: +form.price, totalQuota: +form.totalQuota, includes: form.includes.split('\n').map(s => s.trim()).filter(Boolean), departureDate: form.departureDate || null, returnDate: form.returnDate || null }) })
    await load(); setShow(false); setSaving(false)
  }

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/v1/admin/products/haji/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !isActive }) })
    await load()
  }

  const columns: Column<HajiProduct>[] = [
    { key: 'name', header: 'Nama', mobile: 'title', cell: h => <span className="text-[13px] font-medium">{h.name}</span> },
    { key: 'type', header: 'Jenis', cell: h => <Badge tone="warning" className="capitalize">{h.hajiType}</Badge> },
    { key: 'year', header: 'Tahun', cell: h => <span className="text-[12px] text-admin-muted">{h.year}</span> },
    { key: 'price', header: 'Harga', align: 'right', cell: h => <span className="text-[12px] font-semibold tabular-nums text-admin-ink/80">{formatRupiah(h.price)}</span> },
    {
      key: 'quota', header: 'Kuota', align: 'right',
      cell: h => {
        const sisa = h.totalQuota - h.bookedQuota
        return (
          <span className="text-[12px]">
            <span className={sisa < 5 ? 'font-bold text-admin-danger' : 'font-medium text-admin-ok'}>{sisa}</span>
            <span className="text-admin-muted/70">/{h.totalQuota}</span>
          </span>
        )
      },
    },
    { key: 'status', header: 'Status', cell: h => <Badge tone={h.isActive ? 'ok' : 'neutral'}>{h.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    {
      key: 'actions', header: '', align: 'right',
      cell: h => (
        <button onClick={() => toggleActive(h.id, h.isActive)} className="text-[12px] text-admin-muted transition-colors hover:text-admin-ink">
          {h.isActive ? 'Nonaktifkan' : 'Aktifkan'}
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Star}
        title="Produk Haji"
        description="Kelola paket haji Furoda, Khusus, dan Reguler"
        actions={<button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Produk Haji</button>}
      />

      {show && (
        <div className="admin-form-panel">
          <p className="text-sm font-semibold text-admin-ink">Produk Haji Baru</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2"><p className="text-xs text-admin-muted mb-1">Nama Produk</p><input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Haji Furoda 2027 - Paket Premium" /></div>
            <div><p className="text-xs text-admin-muted mb-1">Jenis Haji</p><select className="admin-select" value={form.hajiType} onChange={set('hajiType')}>{HAJI_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            <div><p className="text-xs text-admin-muted mb-1">Tahun</p><input type="number" className="admin-inp" value={form.year} onChange={set('year')} /></div>
            <div><p className="text-xs text-admin-muted mb-1">Tanggal Berangkat</p><input type="date" className="admin-inp" value={form.departureDate} onChange={set('departureDate')} /></div>
            <div><p className="text-xs text-admin-muted mb-1">Tanggal Kembali</p><input type="date" className="admin-inp" value={form.returnDate} onChange={set('returnDate')} /></div>
            <div><p className="text-xs text-admin-muted mb-1">Durasi (hari)</p><input type="number" className="admin-inp" value={form.durationDays} onChange={set('durationDays')} /></div>
            <div><p className="text-xs text-admin-muted mb-1">Harga/orang (Rp)</p><input type="number" className="admin-inp" value={form.price} onChange={set('price')} /></div>
            <div><p className="text-xs text-admin-muted mb-1">Kuota</p><input type="number" className="admin-inp" value={form.totalQuota} onChange={set('totalQuota')} /></div>
            <div className="lg:col-span-3 min-w-0"><p className="text-xs text-admin-muted mb-1">Deskripsi</p><RichTextEditor id="haji-new-description" title="Deskripsi paket haji" value={form.description} onChange={description => setForm(p => ({ ...p, description }))} placeholder="Program perjalanan, fasilitas, syarat, dan catatan penting…" /></div>
            <div className="lg:col-span-3"><p className="text-xs text-admin-muted mb-1">Yang Termasuk (satu baris per item)</p><textarea className="admin-inp" rows={4} value={form.includes} onChange={set('includes')} placeholder={"Visa Haji\nAkomodasi Makkah\nTransportasi Armuzna"} /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan Produk'}</button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <DataTable columns={columns} rows={list} getRowId={h => h.id} loading={loading} empty="Belum ada produk haji." rowClassName={h => (h.isActive ? undefined : 'opacity-50')} />
    </div>
  )
}
