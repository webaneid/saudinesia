'use client'

import { useState, useEffect } from 'react'
import { Plus, KeyRound, Pencil, Globe } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { useRouter } from 'next/navigation'

const COMMON_DOC_TYPES = [
  'passport', 'ktp', 'kk', 'photo', 'evaksin', 'etiket',
  'rekening', 'sponsor', 'iqomah', 'surat_nikah', 'akta_lahir', 'ijazah',
]

type VisaProduct = {
  id: string; name: string; country: string; visaType: string
  price: number; processDays: number; isActive: boolean
}

export default function VisaPage() {
  const router = useRouter()
  const [list,   setList]   = useState<VisaProduct[]>([])
  const [show,   setShow]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [locale, setLocale] = useState('id')
  const [form, setForm] = useState({
    name: '', country: 'Saudi Arabia', visaType: '', processDays: 14, description: '',
  })

  async function load() {
    const r = await fetch('/api/v1/admin/products/visa')
    const j = await r.json()
    setList(j.data ?? [])
  }

  useEffect(() => {
    load()
    // detect locale from URL
    const parts = window.location.pathname.split('/')
    if (parts[1]) setLocale(parts[1])
  }, [])

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true)
    const r = await fetch('/api/v1/admin/products/visa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, processDays: +form.processDays, requirements: [] }),
    })
    const j = await r.json()
    setSaving(false)
    if (j.data?.id) {
      router.push(`/${locale}/admin/products/visa/${j.data.id}`)
    }
  }

  const grouped = list.reduce<Record<string, VisaProduct[]>>((acc, v) => {
    const key = v.country || 'Saudi Arabia'
    acc[key] = acc[key] ?? []
    acc[key].push(v)
    return acc
  }, {})

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="admin-h1 flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-teal-600" /> Produk Visa
          </h1>
          <p className="text-sm text-slate-500 mt-1">Kelola jenis dan harga visa — bisa multi-negara</p>
        </div>
        <button onClick={() => setShow(!show)} className="admin-btn">
          <Plus className="h-4 w-4" /> Tambah Produk Visa
        </button>
      </div>

      {show && (
        <div className="admin-form-panel space-y-3">
          <p className="text-sm font-semibold text-ink">Produk Visa Baru</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">Nama Produk</p>
              <input className="admin-inp" value={form.name} onChange={set('name')} placeholder="Visa Umroh Reguler 2026" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Negara</p>
              <input className="admin-inp" value={form.country} onChange={set('country')} placeholder="Saudi Arabia" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Jenis Visa (teks bebas)</p>
              <input className="admin-inp" value={form.visaType} onChange={set('visaType')} placeholder="Umroh / Visitor / Bisnis…" list="visa-type-suggestions" />
              <datalist id="visa-type-suggestions">
                {['Umroh', 'Visitor', 'Bisnis', 'Kerja', 'Transit', 'Haji'].map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Estimasi Proses (hari)</p>
              <input type="number" className="admin-inp" value={form.processDays} onChange={set('processDays')} />
            </div>
            <div className="md:col-span-2">
              <p className="text-xs text-slate-500 mb-1">Deskripsi (opsional)</p>
              <textarea className="admin-inp" rows={2} value={form.description} onChange={set('description')} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Harga & persyaratan dokumen diatur di halaman edit setelah produk dibuat — harga terhitung otomatis begitu komponen HPP diisi.</p>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.name || !form.visaType}
              className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? 'Menyimpan...' : 'Simpan & Lanjut →'}
            </button>
            <button onClick={() => setShow(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      {Object.entries(grouped).length === 0 && !show && (
        <div className="admin-card p-10 text-center text-slate-400 text-sm">
          Belum ada produk visa. Klik Tambah untuk mulai.
        </div>
      )}

      {Object.entries(grouped).map(([country, items]) => (
        <div key={country} className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <Globe className="h-3.5 w-3.5" /> {country}
          </div>
          <div className="admin-card overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-line bg-canvas/60">
                <tr>
                  <th className="admin-th">Nama</th>
                  <th className="admin-th">Jenis</th>
                  <th className="admin-th text-right">Harga</th>
                  <th className="admin-th text-right">Proses</th>
                  <th className="admin-th">Status</th>
                  <th className="admin-th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map(v => (
                  <tr key={v.id} className={`hover:bg-canvas/40 transition-colors ${!v.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-ink text-[13px]">{v.name}</td>
                    <td className="px-4 py-3"><span className="admin-badge-blue">{v.visaType}</span></td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-[12px] text-ink2">{formatRupiah(v.price)}</td>
                    <td className="px-4 py-3 text-right text-slate-500 text-[12px]">{v.processDays} hari</td>
                    <td className="px-4 py-3">
                      <span className={v.isActive ? 'admin-badge-green' : 'admin-badge-gray'}>
                        {v.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => router.push(`/${locale}/admin/products/visa/${v.id}`)}
                        className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-ink transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
