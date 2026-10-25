'use client'

import { useEffect, useState } from 'react'
import { Check, Plus, Save, Trash2, Wallet } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { Switch } from '@/components/admin/ui/Switch'
import { formatRupiah } from '@/lib/utils'
import { vendorQuickAddError } from '@/lib/admin/vendorQuickAdd'

const CURRENCIES = ['USD', 'SAR', 'EUR', 'IDR']

type Vendor = { id: string; name: string; country: string; isActive: boolean }
type TierRow = { id: string; minDays: number; maxDays: number; hargaVisa: number; hargaBrn: number | null; sellPriceOverride: number | null }
type RowPreview = { hppRupiah: number; sellPrice: number }
type NumericField = 'minDays' | 'maxDays' | 'hargaVisa' | 'hargaBrn' | 'sellPriceOverride'

const emptyRow = (): TierRow => ({ id: crypto.randomUUID(), minDays: 0, maxDays: 0, hargaVisa: 0, hargaBrn: null, sellPriceOverride: null })

type Props = {
  productId: string
  /** Dipanggil setelah tarif tersimpan: harga produk (cache) berubah, halaman perlu memuat ulang. */
  onSaved: () => void
}

/**
 * HPP & komponen biaya per rentang hari (docs/arsitektur-harga.md §14-§17). Preview live dihitung dari angka yang SEDANG
 * diketik lewat /simulate (bukan /preview yang membaca DB), debounce 500 ms.
 */
export function CostTiersTab({ productId, onSaved }: Props) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [visaVendorId, setVisaVendorId] = useState('')
  const [visaCurrency, setVisaCurrency] = useState('USD')
  const [brnEnabled, setBrnEnabled] = useState(false)
  const [brnVendorId, setBrnVendorId] = useState('')
  const [brnCurrency, setBrnCurrency] = useState('USD')
  const [rows, setRows] = useState<TierRow[]>([])
  const [rowPreviews, setRowPreviews] = useState<Record<string, RowPreview>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        for (const [rowId, preview] of entries) if (preview) next[rowId] = preview
        setRowPreviews(next)
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [rows, visaCurrency, brnEnabled, brnCurrency])

  async function load() {
    const r = await fetch(`/api/v1/admin/products/visa/${productId}/cost-tiers`)
    const j = await r.json()
    if (!j.data) return
    const { visa, brn, rows: loaded } = j.data
    setVisaVendorId(visa?.vendorId ?? '')
    setVisaCurrency(visa?.currency ?? 'USD')
    setBrnEnabled(!!brn)
    setBrnVendorId(brn?.vendorId ?? '')
    setBrnCurrency(brn?.currency ?? 'USD')
    setRows(loaded ?? [])
  }

  useEffect(() => {
    fetch('/api/v1/admin/system/settings/vendors?category=syarikah').then(r => r.json()).then(j => setVendors(j.data ?? []))
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  const addVendor = (v: Vendor) => setVendors(list => [...list, v].sort((a, b) => a.name.localeCompare(b.name)))
  const addRow = () => setRows(r => [...r, emptyRow()])
  const removeRow = (rowId: string) => setRows(r => r.filter(row => row.id !== rowId))
  function updateRow(rowId: string, field: NumericField, value: string) {
    setRows(r => r.map(row => {
      if (row.id !== rowId) return row
      if (field === 'hargaBrn' || field === 'sellPriceOverride') return { ...row, [field]: value === '' ? null : +value }
      return { ...row, [field]: +value }
    }))
  }

  const canSave = !!visaVendorId && rows.length > 0
    && rows.every(r => r.minDays >= 1 && r.maxDays >= r.minDays && r.hargaVisa > 0)
    && (!brnEnabled || !!brnVendorId)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const body = {
      visa: { vendorId: visaVendorId, currency: visaCurrency },
      brn: brnEnabled ? { vendorId: brnVendorId, currency: brnCurrency } : null,
      rows: rows.map(r => ({
        id: r.id, minDays: r.minDays, maxDays: r.maxDays,
        hargaVisa: r.hargaVisa, hargaBrn: brnEnabled ? r.hargaBrn : null,
        sellPriceOverride: r.sellPriceOverride,
      })),
    }
    const res = await fetch(`/api/v1/admin/products/visa/${productId}/cost-tiers`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => null)
      setError(j?.error ?? 'Tarif gagal disimpan. Coba lagi.')
      setSaving(false)
      return
    }
    await load()
    onSaved()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><Wallet className="size-4 text-admin-accent" /> HPP dan komponen biaya</h2>
          <p className="m-0 mt-1 text-xs text-admin-muted">
            Satu baris = satu rentang hari. Harga Visa wajib, Harga BRN opsional. HPP = Harga Visa + Harga BRN, dikonversi ke Rupiah dengan kurs, lalu ditambah margin menjadi harga jual.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="ubin space-y-2.5">
            <p className="m-0 text-xs font-bold text-admin-ink">Harga Visa: vendor dan mata uang</p>
            {vendors.length === 0 && <p className="m-0 text-xs text-admin-warning">Belum ada vendor. Tambahkan dulu.</p>}
            <VendorField vendors={vendors} vendorId={visaVendorId} onSelect={setVisaVendorId} currency={visaCurrency} onCurrency={setVisaCurrency} onVendorCreated={addVendor} label="Vendor harga visa" />
          </div>
          <div className="ubin space-y-2.5">
            <div className="flex items-center gap-2.5">
              <Switch id="brn-enabled" checked={brnEnabled} onChange={setBrnEnabled} label="Pakai komponen BRN" />
              <label htmlFor="brn-enabled" className="cursor-pointer text-xs font-bold text-admin-ink">Produk ini memakai komponen BRN <span className="font-medium text-admin-muted">(opsional)</span></label>
            </div>
            {brnEnabled && <VendorField vendors={vendors} vendorId={brnVendorId} onSelect={setBrnVendorId} currency={brnCurrency} onCurrency={setBrnCurrency} onVendorCreated={addVendor} label="Vendor BRN" />}
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="hidden grid-cols-12 gap-2 px-1 xl:grid">
          <ColHead span="col-span-3">Rentang hari</ColHead>
          <ColHead span="col-span-2">Harga Visa · {visaCurrency}</ColHead>
          <ColHead span="col-span-2">Harga BRN · {brnEnabled ? brnCurrency : '—'}</ColHead>
          <ColHead span="col-span-2">HPP (Rp)</ColHead>
          <ColHead span="col-span-2">Harga jual (Rp)</ColHead>
          <span className="col-span-1" />
        </div>

        {rows.map(row => {
          const preview = rowPreviews[row.id]
          const overridden = row.sellPriceOverride != null
          return (
            <div key={row.id} className={`grid grid-cols-2 items-end gap-2 rounded-xl border p-3 sm:grid-cols-4 xl:grid-cols-12 xl:items-center xl:border-0 xl:p-0 ${overridden ? 'border-admin-warning/40 bg-admin-warning/10 xl:ring-1 xl:ring-admin-warning/30' : 'border-admin-line'}`}>
              <Cell label="Rentang hari (min – maks)" span="col-span-2 xl:col-span-3">
                <div className="flex items-center gap-1.5">
                  <input type="number" min={1} aria-label="Min hari" className="admin-inp no-spin px-2 text-center" placeholder="1" value={row.minDays || ''} onChange={e => updateRow(row.id, 'minDays', e.target.value)} />
                  <span aria-hidden className="text-admin-muted">–</span>
                  <input type="number" min={1} aria-label="Maks hari" className="admin-inp no-spin px-2 text-center" placeholder="7" value={row.maxDays || ''} onChange={e => updateRow(row.id, 'maxDays', e.target.value)} />
                </div>
              </Cell>
              <Cell label={`Harga Visa · ${visaCurrency}`} span="xl:col-span-2"><input type="number" aria-label="Harga Visa" className="admin-inp" value={row.hargaVisa || ''} onChange={e => updateRow(row.id, 'hargaVisa', e.target.value)} /></Cell>
              <Cell label={`Harga BRN · ${brnEnabled ? brnCurrency : '—'}`} span="xl:col-span-2">
                <input
                  type="number" aria-label="Harga BRN" className="admin-inp disabled:bg-admin-spot/50 disabled:opacity-40" placeholder={brnEnabled ? '' : '—'}
                  value={row.hargaBrn ?? ''} disabled={!brnEnabled} onChange={e => updateRow(row.id, 'hargaBrn', e.target.value)}
                />
              </Cell>
              <Cell label="HPP (Rp)" span="xl:col-span-2">
                <p className="m-0 truncate py-2 text-sm font-semibold tabular-nums text-admin-ink">{preview ? formatRupiah(Math.round(preview.hppRupiah)) : '—'}</p>
              </Cell>
              <Cell label="Harga jual (Rp)" span="sm:col-span-2 xl:col-span-2">
                <input
                  type="number" aria-label="Harga jual" className="admin-inp font-semibold placeholder:font-semibold placeholder:text-admin-ink/70"
                  placeholder={preview ? formatRupiah(preview.sellPrice) : 'Otomatis'} value={row.sellPriceOverride ?? ''}
                  onChange={e => updateRow(row.id, 'sellPriceOverride', e.target.value)}
                  title={overridden ? 'Harga manual: menggantikan hasil hitung otomatis' : 'Kosongkan untuk memakai hasil hitung otomatis'}
                />
              </Cell>
              <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 xl:justify-end">
                {overridden && <Badge tone="warning" className="xl:hidden">Manual</Badge>}
                <button type="button" onClick={() => removeRow(row.id)} aria-label="Hapus baris" className="grid size-9 place-items-center rounded-lg text-admin-muted transition-colors hover:bg-admin-danger/10 hover:text-admin-danger">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          )
        })}

        {rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-admin-line-strong px-6 py-8 text-center">
            <p className="m-0 text-sm font-semibold text-admin-ink">Belum ada tarif HPP</p>
            <p className="m-0 mt-1 text-xs text-admin-muted">Klik Tambah rentang untuk mengisi rentang hari dan harga.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="size-4" /> Tambah rentang</Button>
          <p className="m-0 max-w-md text-[11px] text-admin-muted">
            Kolom Harga jual boleh diisi manual (baris berlatar kuning) untuk menimpa harga per rentang. Kosongkan untuk kembali ke HPP + margin, dibulatkan.
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} loading={saving} disabled={!canSave}>
          {saved ? <Check className="size-4" /> : <Save className="size-4" />}
          {saved ? 'Tarif tersimpan' : 'Simpan tabel HPP'}
        </Button>
        {!canSave && <p className="m-0 text-xs text-admin-muted">Pilih vendor dan lengkapi semua baris (hari minimal 1, harga visa lebih dari 0) untuk menyimpan.</p>}
        {error && <p className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
      </div>
    </div>
  )
}

function ColHead({ span, children }: { span: string; children: React.ReactNode }) {
  return <span className={`${span} text-[11px] font-bold uppercase tracking-[0.06em] text-admin-muted`}>{children}</span>
}

function Cell({ label, span, children }: { label: string; span: string; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 ${span}`}>
      <span className="mb-1 block text-[11px] font-semibold text-admin-muted xl:hidden">{label}</span>
      {children}
    </div>
  )
}

type VendorFieldProps = {
  vendors: Vendor[]
  vendorId: string
  onSelect: (id: string) => void
  currency: string
  onCurrency: (c: string) => void
  onVendorCreated: (v: Vendor) => void
  label: string
}

// Komponen tingkat atas (bukan didefinisikan di dalam CostTiersTab) supaya tidak di-mount ulang tiap render,
// yang membuat kolom "nama vendor" kehilangan fokus di setiap ketikan.
function VendorField({ vendors, vendorId, onSelect, currency, onCurrency, onVendorCreated, label }: VendorFieldProps) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    const r = await fetch('/api/v1/admin/system/settings/vendors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), category: 'syarikah' }),
    })
    const j = await r.json().catch(() => null)
    setSaving(false)
    if (!j?.data?.id) { setError(vendorQuickAddError(r.status, j?.error)); return }
    onVendorCreated(j.data)
    onSelect(j.data.id)
    setName('')
    setAdding(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {!adding ? (
          <select aria-label={label} className="admin-select min-w-0 flex-1" value={vendorId} onChange={e => onSelect(e.target.value)}>
            <option value="">Pilih vendor…</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        ) : (
          <input
            autoFocus aria-label="Nama vendor baru" className="admin-inp min-w-0 flex-1" placeholder="Nama vendor, mis. BRN" value={name}
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create() } }}
          />
        )}
        <select aria-label="Mata uang" className="admin-select w-24 shrink-0" value={currency} onChange={e => onCurrency(e.target.value)}>
          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {!adding ? (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-admin-accent-strong hover:underline">
          <Plus className="size-3.5" /> Vendor baru
        </button>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" loading={saving} disabled={!name.trim()} onClick={create}>Simpan vendor</Button>
          <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setName(''); setError(null) }}>Batal</Button>
        </div>
      )}
      {error && <p className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
    </div>
  )
}
