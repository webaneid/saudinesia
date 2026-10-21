'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Plus, Trash2, GripVertical, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import type { VisaRequirement } from '@/lib/types/visa'

const COMMON_DOC_TYPES = [
  'passport', 'ktp', 'kk', 'photo', 'evaksin', 'etiket',
  'rekening', 'sponsor', 'iqomah', 'surat_nikah', 'akta_lahir', 'ijazah',
]

const CURRENCIES = ['USD', 'SAR', 'EUR', 'IDR']

type Vendor = { id: string; name: string; country: string; isActive: boolean }

type TierRow = {
  id: string; minDays: number; maxDays: number
  hargaVisa: number; hargaBrn: number | null; sellPriceOverride: number | null
}
type RowPreview = { hppRupiah: number; sellPrice: number }

const emptyRow = (): TierRow => ({
  id: crypto.randomUUID(), minDays: 0, maxDays: 0, hargaVisa: 0, hargaBrn: null, sellPriceOverride: null,
})

type Product = {
  id: string; name: string; country: string; visaType: string; description: string | null
  requirements: VisaRequirement[]; price: number; priceLabel: string | null
  processDays: number; isActive: boolean
  // docs/arsitektur-dokumen.md §4 — sumber kebenaran baru, dikirim GET berdampingan `requirements`
  // (Json lama, deprecated)
  documentRequirements: { docType: string; label: string; description: string; required: boolean }[]
}

type Props = { params: Promise<{ locale: string; id: string }> }

const emptyReq = (): VisaRequirement => ({
  docType: '', label: '', description: '', required: true,
})

export default function VisaEditPage({ params }: Props) {
  const router = useRouter()
  const [id, setId]       = useState('')
  const [locale, setLocale] = useState('id')
  const [product, setProduct] = useState<Product | null>(null)
  const [form, setForm] = useState({
    name: '', country: 'Saudi Arabia', visaType: '', description: '',
    processDays: '14', isActive: true,
  })
  const [reqs, setReqs] = useState<VisaRequirement[]>([])
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [visaVendorId, setVisaVendorId] = useState('')
  const [visaCurrency, setVisaCurrency] = useState('USD')
  const [brnEnabled, setBrnEnabled] = useState(false)
  const [brnVendorId, setBrnVendorId] = useState('')
  const [brnCurrency, setBrnCurrency] = useState('USD')
  const [rows, setRows] = useState<TierRow[]>([])
  const [rowPreviews, setRowPreviews] = useState<Record<string, RowPreview>>({})
  const [savingTiers, setSavingTiers] = useState(false)
  const [tiersSaved, setTiersSaved] = useState(false)

  const [vendorQuickAddTarget, setVendorQuickAddTarget] = useState<'visa' | 'brn' | null>(null)
  const [newVendorName, setNewVendorName] = useState('')
  const [savingVendor, setSavingVendor] = useState(false)

  // Preview live — dihitung dari angka yang SEDANG diketik (belum tentu tersimpan), lewat
  // /simulate (bukan /preview yang baca dari DB). Debounce 500ms, dipicu baik saat mengetik
  // maupun saat data baru dimuat dari server (rows berubah dari [] ke isi). Lihat §16.
  useEffect(() => {
    const timer = setTimeout(() => {
      const targetRows = rows.filter(r => r.hargaVisa > 0)
      if (targetRows.length === 0) { setRowPreviews({}); return }
      Promise.all(targetRows.map(async row => {
        const params = new URLSearchParams({ visaCost: String(row.hargaVisa), visaCurrency })
        if (brnEnabled && row.hargaBrn) {
          params.set('brnCost', String(row.hargaBrn))
          params.set('brnCurrency', brnCurrency)
        }
        const r = await fetch(`/api/v1/admin/products/visa/simulate?${params}`)
        const j = await r.json()
        return [row.id, j.data ? { hppRupiah: j.data.hppRupiah, sellPrice: j.data.sellPrice } : null] as const
      })).then(entries => {
        const next: Record<string, RowPreview> = {}
        for (const [rowId, preview] of entries) {
          if (preview) next[rowId] = preview
        }
        setRowPreviews(next)
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [rows, visaCurrency, brnEnabled, brnCurrency])

  async function loadCostTiers(productId: string) {
    const r = await fetch(`/api/v1/admin/products/visa/${productId}/cost-tiers`)
    const j = await r.json()
    if (j.data) {
      const { visa, brn, rows: loadedRows } = j.data
      setVisaVendorId(visa?.vendorId ?? '')
      setVisaCurrency(visa?.currency ?? 'USD')
      setBrnEnabled(!!brn)
      setBrnVendorId(brn?.vendorId ?? '')
      setBrnCurrency(brn?.currency ?? 'USD')
      setRows(loadedRows ?? [])
    }
    // VisaProduct.price adalah cache turunan komponen HPP (docs/arsitektur-harga.md §17) —
    // refresh juga setiap kali cost-tiers berubah supaya tampilan read-only-nya tidak basi.
    const pr = await fetch(`/api/v1/admin/products/visa/${productId}`)
    const pj = await pr.json()
    if (pj.data) setProduct(pj.data)
  }

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id); setLocale(p.locale)
      const r = await fetch(`/api/v1/admin/products/visa/${p.id}`)
      const j = await r.json()
      if (j.data) {
        const v: Product = j.data
        setProduct(v)
        setForm({
          name: v.name, country: v.country, visaType: v.visaType,
          description: v.description ?? '',
          processDays: v.processDays.toString(), isActive: v.isActive,
        })
        setReqs(Array.isArray(v.documentRequirements)
          ? v.documentRequirements.map(r => ({ docType: r.docType, label: r.label, description: r.description, required: r.required }))
          : [])
      }
      const vr = await fetch('/api/v1/admin/system/settings/vendors?category=syarikah')
      const vj = await vr.json()
      setVendors(vj.data ?? [])
      await loadCostTiers(p.id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  async function handleQuickAddVendor(target: 'visa' | 'brn') {
    if (!newVendorName.trim()) return
    setSavingVendor(true)
    const r = await fetch('/api/v1/admin/system/settings/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newVendorName.trim(), category: 'syarikah' }),
    })
    const j = await r.json()
    setSavingVendor(false)
    if (j.data?.id) {
      setVendors(v => [...v, j.data].sort((a, b) => a.name.localeCompare(b.name)))
      if (target === 'visa') setVisaVendorId(j.data.id)
      else setBrnVendorId(j.data.id)
      setNewVendorName('')
      setVendorQuickAddTarget(null)
    }
  }

  function addRow() {
    setRows(r => [...r, emptyRow()])
  }
  function removeRow(rowId: string) {
    setRows(r => r.filter(row => row.id !== rowId))
  }
  function updateRow(rowId: string, field: 'minDays' | 'maxDays' | 'hargaVisa' | 'hargaBrn' | 'sellPriceOverride', value: string) {
    setRows(r => r.map(row => {
      if (row.id !== rowId) return row
      if (field === 'hargaBrn' || field === 'sellPriceOverride') return { ...row, [field]: value === '' ? null : +value }
      return { ...row, [field]: +value }
    }))
  }

  const canSaveTiers = !!visaVendorId && rows.length > 0
    && rows.every(r => r.minDays >= 1 && r.maxDays >= r.minDays && r.hargaVisa > 0)
    && (!brnEnabled || !!brnVendorId)

  async function handleSaveCostTiers() {
    setSavingTiers(true)
    const body = {
      visa: { vendorId: visaVendorId, currency: visaCurrency },
      brn: brnEnabled ? { vendorId: brnVendorId, currency: brnCurrency } : null,
      rows: rows.map(r => ({
        id: r.id, minDays: r.minDays, maxDays: r.maxDays,
        hargaVisa: r.hargaVisa, hargaBrn: brnEnabled ? r.hargaBrn : null,
        sellPriceOverride: r.sellPriceOverride,
      })),
    }
    await fetch(`/api/v1/admin/products/visa/${id}/cost-tiers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await loadCostTiers(id)
    setSavingTiers(false); setTiersSaved(true)
    setTimeout(() => setTiersSaved(false), 2000)
  }

  function setField(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  }

  function addReq() {
    setReqs(r => [...r, emptyReq()])
  }

  function removeReq(i: number) {
    setReqs(r => r.filter((_, idx) => idx !== i))
  }

  function updateReq(i: number, field: keyof VisaRequirement, value: string | boolean) {
    setReqs(r => r.map((req, idx) => idx === i ? { ...req, [field]: value } : req))
  }

  async function handleSave() {
    setSaving(true)
    await fetch(`/api/v1/admin/products/visa/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        processDays: +form.processDays,
        requirements: reqs.filter(r => r.docType && r.label),
      }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleDelete() {
    if (!confirm(`Hapus produk visa "${product?.name}"? Tindakan ini tidak bisa dibatalkan.`)) return
    await fetch(`/api/v1/admin/products/visa/${id}`, { method: 'DELETE' })
    router.push(`/${locale}/admin/products/visa`)
  }

  if (!product) return <div className="text-sm text-admin-muted/70 p-6">Memuat...</div>

  function VendorPicker({ target, vendorId, onSelect, currency, onCurrency }: {
    target: 'visa' | 'brn'; vendorId: string; onSelect: (id: string) => void
    currency: string; onCurrency: (c: string) => void
  }) {
    const isAdding = vendorQuickAddTarget === target
    return (
      <div className="flex items-center gap-2">
        {!isAdding ? (
          <>
            <select className="admin-inp flex-1" value={vendorId} onChange={e => onSelect(e.target.value)}>
              <option value="">Pilih vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button
              type="button" onClick={() => setVendorQuickAddTarget(target)}
              className="admin-btn-ghost text-xs shrink-0 flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Vendor Baru
            </button>
          </>
        ) : (
          <>
            <input
              autoFocus className="admin-inp flex-1" placeholder="Nama vendor, mis. BRN"
              value={newVendorName} onChange={e => setNewVendorName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleQuickAddVendor(target) } }}
            />
            <button
              type="button" onClick={() => handleQuickAddVendor(target)}
              disabled={savingVendor || !newVendorName.trim()}
              className="admin-btn-sm text-xs shrink-0 disabled:opacity-50"
            >
              {savingVendor ? '...' : 'Simpan'}
            </button>
            <button
              type="button" onClick={() => { setVendorQuickAddTarget(null); setNewVendorName('') }}
              className="admin-btn-ghost text-xs shrink-0"
            >
              Batal
            </button>
          </>
        )}
        <select className="admin-inp w-20 shrink-0" value={currency} onChange={e => onCurrency(e.target.value)}>
          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push(`/${locale}/admin/products/visa`)}
          className="text-admin-muted/70 hover:text-admin-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="admin-h1">Edit Produk Visa</h1>
      </div>

      {/* Basic info */}
      <div className="admin-form-panel space-y-4">
        <p className="text-sm font-semibold text-admin-ink">Informasi Dasar</p>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-admin-muted mb-1">Nama Produk</p>
            <input className="admin-inp" value={form.name} onChange={setField('name')} />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Negara</p>
            <input className="admin-inp" value={form.country} onChange={setField('country')} placeholder="Saudi Arabia" />
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Jenis Visa (teks bebas)</p>
            <input
              className="admin-inp" value={form.visaType} onChange={setField('visaType')}
              placeholder="Umroh / Visitor / Bisnis…" list="visa-type-suggestions"
            />
            <datalist id="visa-type-suggestions">
              {['Umroh', 'Visitor', 'Bisnis', 'Kerja', 'Transit', 'Haji'].map(t => <option key={t} value={t} />)}
            </datalist>
          </div>
          <div>
            <p className="text-xs text-admin-muted mb-1">Estimasi Proses (hari)</p>
            <input type="number" className="admin-inp" value={form.processDays} onChange={setField('processDays')} />
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-admin-muted mb-1">Deskripsi (opsional)</p>
            <textarea className="admin-inp" rows={2} value={form.description} onChange={setField('description')} />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer w-fit">
          <div
            onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-admin-ink">Aktif (tampil di katalog)</span>
        </label>

        <div className="admin-card p-3 flex items-center gap-3">
          <p className="text-xs text-admin-muted">Harga saat ini:</p>
          <p className="text-sm font-bold text-admin-ink">{formatRupiah(product.price)}</p>
          <p className="text-xs text-admin-muted/70">/ orang · proses ~{form.processDays} hari kerja — dihitung otomatis dari HPP &amp; Komponen Biaya di bawah</p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving || !form.name || !form.visaType}
            className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan'}
          </button>
        </div>
      </div>

      {/* Requirements builder */}
      <div className="admin-form-panel space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-admin-ink">Persyaratan Dokumen</p>
            <p className="text-[11px] text-admin-muted/70 mt-0.5">
              Dokumen yang wajib/opsional diupload jamaah untuk visa ini
            </p>
          </div>
          <button onClick={addReq} className="admin-btn-sm flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Tambah
          </button>
        </div>

        {reqs.length === 0 && (
          <p className="text-[13px] text-admin-muted/70 py-4 text-center border border-dashed border-admin-line rounded-xl">
            Belum ada persyaratan. Klik Tambah untuk menambah dokumen.
          </p>
        )}

        <div className="space-y-3">
          {reqs.map((req, i) => (
            <div key={i} className="border border-admin-line rounded-xl p-4 space-y-3 bg-admin-spot/30">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-admin-muted/50">
                  <GripVertical className="h-4 w-4 shrink-0" />
                  <span className="text-[11px] font-semibold text-admin-muted">Dokumen #{i + 1}</span>
                </div>
                <button
                  onClick={() => removeReq(i)}
                  className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-admin-muted mb-1">docType (kunci mesin)</p>
                  <input
                    className="admin-inp font-mono text-[13px]"
                    value={req.docType}
                    onChange={e => updateReq(i, 'docType', e.target.value)}
                    placeholder="passport"
                    list="doc-type-suggestions"
                  />
                  <datalist id="doc-type-suggestions">
                    {COMMON_DOC_TYPES.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
                <div>
                  <p className="text-xs text-admin-muted mb-1">Label (tampil ke jamaah)</p>
                  <input
                    className="admin-inp"
                    value={req.label}
                    onChange={e => updateReq(i, 'label', e.target.value)}
                    placeholder="Paspor Asli (scan semua halaman)"
                  />
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs text-admin-muted mb-1">Instruksi detail (opsional)</p>
                  <input
                    className="admin-inp"
                    value={req.description}
                    onChange={e => updateReq(i, 'description', e.target.value)}
                    placeholder="Min. 7 bulan berlaku dari tanggal keberangkatan"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                <div
                  onClick={() => updateReq(i, 'required', !req.required)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${req.required ? 'bg-admin-accent' : 'bg-admin-line-strong'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${req.required ? 'translate-x-4' : ''}`} />
                </div>
                <span className="text-[13px] font-medium text-admin-ink">
                  {req.required ? 'Wajib' : 'Opsional'}
                </span>
                <span className="text-[11px] text-admin-muted/70">
                  {req.required ? '— harus diupload sebelum bisa lanjut' : '— tidak memblokir proses'}
                </span>
              </label>
            </div>
          ))}
        </div>

        {reqs.length > 0 && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !form.name || !form.visaType}
              className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Menyimpan...' : saved ? 'Tersimpan ✓' : 'Simpan Persyaratan'}
            </button>
          </div>
        )}
      </div>

      {/* HPP & Komponen Biaya */}
      <div className="admin-form-panel space-y-4">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-4 w-4" /> HPP &amp; Komponen Biaya</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">
            Satu baris = satu rentang hari. Harga Visa wajib, Harga BRN opsional. HPP = Harga Visa + Harga BRN, dikonversi ke Rupiah pakai kurs, ditambah margin jadi Harga Jual — lihat docs/arsitektur-harga.md §14
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="border border-admin-line rounded-xl p-3 space-y-2">
            <p className="text-xs font-semibold text-admin-ink">Vendor &amp; Mata Uang — Harga Visa</p>
            {vendors.length === 0 && vendorQuickAddTarget !== 'visa' && (
              <p className="text-[11px] text-admin-warning">Belum ada vendor — tambah dulu.</p>
            )}
            <VendorPicker target="visa" vendorId={visaVendorId} onSelect={setVisaVendorId} currency={visaCurrency} onCurrency={setVisaCurrency} />
          </div>
          <div className="border border-admin-line rounded-xl p-3 space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-admin-ink cursor-pointer w-fit">
              <input type="checkbox" checked={brnEnabled} onChange={e => setBrnEnabled(e.target.checked)} className="h-3.5 w-3.5" />
              Produk ini pakai komponen BRN (opsional)
            </label>
            {brnEnabled && (
              <VendorPicker target="brn" vendorId={brnVendorId} onSelect={setBrnVendorId} currency={brnCurrency} onCurrency={setBrnCurrency} />
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-admin-muted/70 font-medium px-1">
            <span className="w-16">Min Hari</span>
            <span className="w-16">Maks Hari</span>
            <span className="w-24">Harga Visa</span>
            <span className="w-24">Harga BRN</span>
            <span className="w-28">HPP</span>
            <span className="w-32">Harga Jual</span>
            <span className="w-8" />
          </div>
          {rows.map(row => {
            const preview = rowPreviews[row.id]
            const isOverridden = row.sellPriceOverride != null
            return (
              <div
                key={row.id}
                className={`flex items-center gap-2 rounded-lg ${isOverridden ? 'bg-admin-warning/10 ring-1 ring-admin-warning/30' : ''}`}
              >
                <input type="number" className="admin-inp w-16" placeholder="Min" value={row.minDays || ''} onChange={e => updateRow(row.id, 'minDays', e.target.value)} />
                <input type="number" className="admin-inp w-16" placeholder="Maks" value={row.maxDays || ''} onChange={e => updateRow(row.id, 'maxDays', e.target.value)} />
                <input type="number" className="admin-inp w-24" placeholder="Harga Visa" value={row.hargaVisa || ''} onChange={e => updateRow(row.id, 'hargaVisa', e.target.value)} />
                <input
                  type="number" className="admin-inp w-24 disabled:opacity-40 disabled:bg-admin-spot/50" placeholder={brnEnabled ? 'Harga BRN' : '—'}
                  value={row.hargaBrn ?? ''} disabled={!brnEnabled}
                  onChange={e => updateRow(row.id, 'hargaBrn', e.target.value)}
                />
                <span className="w-28 text-[13px] font-semibold text-admin-ink truncate" title={preview ? formatRupiah(Math.round(preview.hppRupiah)) : undefined}>
                  {preview ? formatRupiah(Math.round(preview.hppRupiah)) : '—'}
                </span>
                <input
                  type="number" className="admin-inp w-32 font-semibold text-admin-ink placeholder:font-semibold placeholder:text-admin-ink placeholder:opacity-70"
                  placeholder={preview ? formatRupiah(preview.sellPrice) : 'Otomatis'}
                  value={row.sellPriceOverride ?? ''}
                  onChange={e => updateRow(row.id, 'sellPriceOverride', e.target.value)}
                  title={isOverridden ? 'Harga manual — menggantikan hasil hitung otomatis' : 'Kosongkan untuk pakai hasil hitung otomatis'}
                />
                <button onClick={() => removeRow(row.id)} className="h-8 w-8 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
          <button onClick={addRow} className="admin-btn-ghost text-xs flex items-center gap-1"><Plus className="h-3 w-3" /> Tambah Baris</button>
          <p className="text-[11px] text-admin-muted/70">
            Kolom Harga Jual bisa diisi manual (baris berwarna kuning) untuk override harga publish per rentang hari — kosongkan untuk kembali ke hasil hitung otomatis (HPP + margin, dibulatkan).
          </p>
        </div>

        {rows.length === 0 && (
          <p className="text-[13px] text-admin-muted/70 py-4 text-center border border-dashed border-admin-line rounded-xl">
            Belum ada tarif HPP. Klik &quot;Tambah Baris&quot; untuk mulai isi rentang hari + harga.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSaveCostTiers}
            disabled={savingTiers || !canSaveTiers}
            className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {savingTiers ? 'Menyimpan...' : tiersSaved ? 'Tersimpan ✓' : 'Simpan Tabel HPP'}
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="admin-form-panel border-admin-danger/20 space-y-3">
        <p className="text-sm font-semibold text-admin-danger">Zona Berbahaya</p>
        <p className="text-[12px] text-admin-muted">
          Hapus produk visa ini secara permanen. Data jamaah yang sudah memesan tidak terpengaruh.
        </p>
        <button
          onClick={handleDelete}
          className="px-4 py-2 rounded-xl border border-admin-danger/30 text-[13px] font-medium text-admin-danger hover:bg-admin-danger/10 transition-colors"
        >
          Hapus Produk Visa
        </button>
      </div>
    </div>
  )
}
