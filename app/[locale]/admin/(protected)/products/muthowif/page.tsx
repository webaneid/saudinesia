'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Save, Pencil, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'

const CURRENCIES = ['IDR', 'SAR', 'USD', 'EUR']

type Muthowif = { id: string; name: string; rating: number; dailyCapacity: number; isActive: boolean }
type Preview = { hppRupiah: number; sellPrice: number }

export default function MuthowifPage() {
  const router = useRouter()
  const { locale } = useParams() as { locale: string }

  const [list, setList] = useState<Muthowif[]>([])
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', bio: '', dailyCapacity: 40, languages: 'Bahasa Indonesia' })

  // HPP layanan muthowif — satu komponen flat, tidak per-orang, cache di MuthowifServicePrice.price
  // (docs/arsitektur-muthowif.md §10). Tidak ada vendor pihak ketiga sungguhan di sini (beda dari
  // Visa/Flight/Hotel/Transport) — Saudinesia menetapkan sendiri harga pasaran, jadi vendor
  // ("Saudinesia", dibuat otomatis server-side) cuma ditampilkan read-only, tidak dipilih admin.
  const [currentPrice, setCurrentPrice] = useState(0)
  const [vendorName, setVendorName] = useState('Saudinesia')
  const [currency, setCurrency] = useState('IDR')
  const [hargaLayanan, setHargaLayanan] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [savingPrice, setSavingPrice] = useState(false)
  const [priceSaved, setPriceSaved] = useState(false)

  async function load() {
    const r = await fetch('/api/v1/admin/products/muthowif')
    const j = await r.json()
    setList(j.data ?? [])
  }
  async function loadPrice() {
    const sr = await fetch('/api/v1/admin/products/muthowif/service-price')
    const sj = await sr.json()
    if (sj.data) setCurrentPrice(sj.data.price)

    const cr = await fetch('/api/v1/admin/products/muthowif/service-price/cost')
    const cj = await cr.json()
    if (cj.data) {
      setVendorName(cj.data.vendorName ?? 'Saudinesia')
      setCurrency(cj.data.currency ?? 'IDR')
      setHargaLayanan(cj.data.hargaLayanan ? String(cj.data.hargaLayanan) : '')
    }
  }
  useEffect(() => { load(); loadPrice() }, [])

  // Live preview harga jual — debounce 500ms, pola sama Flight/Transport cost editor.
  useEffect(() => {
    const cost = Number(hargaLayanan)
    if (!cost || cost <= 0) { setPreview(null); return }
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ hargaLayanan: String(cost), currency })
      const r = await fetch(`/api/v1/admin/products/muthowif/service-price/simulate?${params}`)
      const j = await r.json()
      setPreview(j.data ? { hppRupiah: j.data.hppRupiah, sellPrice: j.data.sellPrice } : null)
    }, 500)
    return () => clearTimeout(timer)
  }, [hargaLayanan, currency])

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true)
    await fetch('/api/v1/admin/products/muthowif', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form, dailyCapacity: +form.dailyCapacity,
        languages: form.languages.split(',').map(s => s.trim()).filter(Boolean),
      }),
    })
    await load(); setShow(false); setSaving(false)
  }

  const canSavePrice = Number(hargaLayanan) > 0

  async function handleSavePrice() {
    setSavingPrice(true)
    await fetch('/api/v1/admin/products/muthowif/service-price/cost', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency, hargaLayanan: Number(hargaLayanan) }),
    })
    await loadPrice()
    setSavingPrice(false); setPriceSaved(true)
    setTimeout(() => setPriceSaved(false), 2000)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="admin-h1">Muthowif</h1>
        <button onClick={() => setShow(!show)} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</button>
      </div>

      {/* HPP layanan — satu harga flat, bukan per-orang (docs/arsitektur-muthowif.md §9/§10) */}
      <div className="admin-form-panel space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink flex items-center gap-1.5"><Wallet className="h-4 w-4" /> HPP &amp; Harga Layanan Muthowif</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Satu harga berlaku untuk semua booking — muthowif spesifik ditentukan admin belakangan, jamaah membayar untuk jasa pembimbingan, bukan memilih orang tertentu.
          </p>
        </div>

        <div className="admin-card p-3 flex items-center gap-3">
          <p className="text-xs text-slate-500">Harga saat ini:</p>
          <p className="text-sm font-bold text-ink">{formatRupiah(currentPrice)}</p>
          <p className="text-xs text-slate-400">/ hari — dihitung otomatis dari HPP di bawah</p>
        </div>

        <div className="border border-line rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-ink">Vendor &amp; Mata Uang</p>
          <p className="text-[11px] text-slate-400">
            Muthowif tidak punya vendor pihak ketiga — Saudinesia menetapkan sendiri harga pasarannya.
          </p>
          <div className="flex items-center gap-2">
            <p className="admin-inp flex-1 bg-slate-50 text-slate-600">{vendorName}</p>
            <select className="admin-inp w-20 shrink-0" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div>
            <p className="text-xs text-slate-500 mb-1">Harga Layanan ({currency})</p>
            <input type="number" className="admin-inp" value={hargaLayanan} onChange={e => setHargaLayanan(e.target.value)} placeholder="0" />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">HPP (Rupiah)</p>
            <p className="admin-inp bg-slate-50 font-semibold text-ink">{preview ? formatRupiah(Math.round(preview.hppRupiah)) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Harga Jual (otomatis)</p>
            <p className="admin-inp bg-slate-50 font-semibold text-ink">{preview ? formatRupiah(preview.sellPrice) : '—'}</p>
          </div>
        </div>

        <button onClick={handleSavePrice} disabled={savingPrice || !canSavePrice} className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {savingPrice ? 'Menyimpan...' : priceSaved ? 'Tersimpan ✓' : 'Simpan Harga Layanan'}
        </button>
      </div>

      {show && (
        <div className="admin-form-panel">
          <p className="text-sm font-semibold text-ink mb-1">Muthowif Baru</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div><p className="text-xs text-slate-500 mb-1">Nama</p><input className="admin-inp" value={form.name} onChange={set('name')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Bahasa (pisah koma)</p><input className="admin-inp" value={form.languages} onChange={set('languages')} placeholder="Bahasa Indonesia, Arab" /></div>
            <div className="md:col-span-2"><p className="text-xs text-slate-500 mb-1">Bio</p><textarea className="admin-inp" rows={2} value={form.bio} onChange={set('bio')} /></div>
            <div><p className="text-xs text-slate-500 mb-1">Kapasitas/hari</p><input type="number" className="admin-inp" value={form.dailyCapacity} onChange={set('dailyCapacity')} /></div>
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
            <th className="admin-th">Nama</th>
            <th className="admin-th">Rating</th>
            <th className="admin-th text-right">Kap/hari</th>
            <th className="admin-th">Status</th>
            <th className="admin-th"></th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {list.map(m => (
              <tr key={m.id} className={`hover:bg-canvas/40 transition-colors ${!m.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 text-ink font-medium text-[13px]">{m.name}</td>
                <td className="px-4 py-3 text-gold-600 text-[12px]">★ {m.rating}</td>
                <td className="px-4 py-3 text-right text-slate-500 text-[12px]">{m.dailyCapacity}</td>
                <td className="px-4 py-3">
                  <span className={m.isActive ? 'admin-badge-green' : 'admin-badge-gray'}>
                    {m.isActive ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => router.push(`/${locale}/admin/products/muthowif/${m.id}`)}
                    className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-ink transition-colors">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">Belum ada muthowif.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
