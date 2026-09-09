'use client'

import { useState, useEffect } from 'react'
import { Plus, Star } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'

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
  const [form, setForm] = useState({ name: '', hajiType: 'furoda', year: new Date().getFullYear() + 1, departureDate: '', returnDate: '', durationDays: 40, price: 150000000, totalQuota: 50, description: '', includes: '' })

  async function load() { const r = await fetch('/api/v1/admin/products/haji'); const j = await r.json(); setList(j.data ?? []) }
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

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="admin-h1 flex items-center gap-2"><Star className="h-5 w-5 text-gold-600" /> Produk Haji</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola paket haji Furoda, Khusus, dan Reguler</p>
        </div>
        <button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Produk Haji</button>
      </div>

      {show && (
        <div className="admin-form-panel">
          <p className="text-sm font-semibold text-ink">Produk Haji Baru</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2"><p className="text-xs text-slate-500 mb-1">Nama Produk</p><input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Haji Furoda 2027 - Paket Premium" /></div>
            <div><p className="text-xs text-slate-500 mb-1">Jenis Haji</p><select className="admin-select" value={form.hajiType} onChange={set('hajiType')}>{HAJI_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            <div><p className="text-xs text-slate-500 mb-1">Tahun</p><input type="number" className="admin-inp" value={form.year} onChange={set('year')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Tanggal Berangkat</p><input type="date" className="admin-inp" value={form.departureDate} onChange={set('departureDate')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Tanggal Kembali</p><input type="date" className="admin-inp" value={form.returnDate} onChange={set('returnDate')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Durasi (hari)</p><input type="number" className="admin-inp" value={form.durationDays} onChange={set('durationDays')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Harga/orang (Rp)</p><input type="number" className="admin-inp" value={form.price} onChange={set('price')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Kuota</p><input type="number" className="admin-inp" value={form.totalQuota} onChange={set('totalQuota')} /></div>
            <div className="lg:col-span-3"><p className="text-xs text-slate-500 mb-1">Deskripsi</p><textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} /></div>
            <div className="lg:col-span-3"><p className="text-xs text-slate-500 mb-1">Yang Termasuk (satu baris per item)</p><textarea className="admin-inp" rows={4} value={form.includes} onChange={set('includes')} placeholder={"Visa Haji\nAkomodasi Makkah\nTransportasi Armuzna"} /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name} className="admin-btn-sm disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan Produk'}</button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60"><tr>
            <th className="admin-th">Nama</th>
            <th className="admin-th">Jenis</th>
            <th className="admin-th">Tahun</th>
            <th className="admin-th text-right">Harga</th>
            <th className="admin-th text-right">Kuota</th>
            <th className="admin-th">Status</th>
            <th className="admin-th"></th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {list.map(h => {
              const sisa = h.totalQuota - h.bookedQuota
              return (
                <tr key={h.id} className={`hover:bg-canvas/40 transition-colors ${!h.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-ink text-[13px]">{h.name}</td>
                  <td className="px-4 py-3"><span className="admin-badge-amber capitalize">{h.hajiType}</span></td>
                  <td className="px-4 py-3 text-slate-500 text-[12px]">{h.year}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-[12px] text-ink2">{formatRupiah(h.price)}</td>
                  <td className="px-4 py-3 text-right text-[12px]">
                    <span className={sisa < 5 ? 'text-rose-600 font-bold' : 'text-mint-700 font-medium'}>{sisa}</span>
                    <span className="text-slate-400">/{h.totalQuota}</span>
                  </td>
                  <td className="px-4 py-3"><span className={h.isActive ? 'admin-badge-green' : 'admin-badge-gray'}>{h.isActive ? 'Aktif' : 'Nonaktif'}</span></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleActive(h.id, h.isActive)} className="text-[12px] text-slate-500 hover:text-ink transition-colors">
                      {h.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
