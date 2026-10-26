'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Pencil, Plus, Save, Trash2, Wallet } from 'lucide-react'
import { VendorCurrencyField } from './VendorCurrencyField'

type CostRow = { id: string; costComponent: string; vendorId: string; vendorName: string; currency: string; cost: number; hppRupiah: number | null; sellPrice: number | null }
type Preview = { hppRupiah: number; sellPrice: number }

const CURRENCIES = ['IDR', 'SAR', 'USD', 'EUR'] as const
const EMPTY_FORM = { costComponent: '', vendorId: '', currency: 'IDR', cost: '' }

function rupiah(n: number) {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`
}

type Props = {
  /** Awalan route komponen biaya, mis. `/api/v1/admin/products/packages/<id>/costs` (GET/POST; `/<costId>` PUT/DELETE; `/simulate`). */
  apiBase: string
  /** Kalimat penjelas di bawah judul. */
  hint: ReactNode
  /** Contoh nama komponen pada input. */
  namePlaceholder: string
  /** Dipanggil setelah komponen ditambah/diubah/dihapus — induk memuat ulang ringkasan harganya. */
  onChanged?: () => void | Promise<void>
}

/**
 * Panel "Komponen Biaya" (komponen universal ke-6, docs/arsitektur-komponen-biaya.md §3.2): daftar komponen biaya bebas milik satu produk,
 * form tambah/ubah (vendor + mata uang + nominal) dengan pratinjau HPP → Harga Jual langsung, hapus, dan total. CRUD lengkap; margin per
 * komponen dihitung server. Memuat data sendiri dari `apiBase`.
 */
export function CostComponentsPanel({ apiBase, hint, namePlaceholder, onChanged }: Props) {
  const [costs, setCosts] = useState<CostRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const loadCosts = useCallback(async () => {
    const r = await fetch(apiBase)
    // HPP dan komponen biaya hanya untuk superadmin (seluruh endpoint biaya) — manager yang membuka halaman produk harus diberi tahu, bukan
    // melihat daftar kosong yang seolah "belum ada komponen".
    setForbidden(r.status === 401 || r.status === 403)
    const j = await r.json().catch(() => null)
    setCosts(j?.data ?? [])
  }, [apiBase])

  useEffect(() => { loadCosts() }, [loadCosts])

  // Pratinjau HPP/Harga Jual langsung — debounce 500 ms, memakai margin tipe PEMILIK panel ini (docs/arsitektur-tiket-pesawat.md §4).
  useEffect(() => {
    const cost = Number(form.cost)
    if (!cost || cost <= 0) { setPreview(null); return }
    const timer = setTimeout(async () => {
      const p = new URLSearchParams({ cost: String(cost), currency: form.currency })
      const r = await fetch(`${apiBase}/simulate?${p}`)
      const j = await r.json().catch(() => null)
      setPreview(j?.data ? { hppRupiah: j.data.hppRupiah, sellPrice: j.data.sellPrice } : null)
    }, 500)
    return () => clearTimeout(timer)
  }, [form.cost, form.currency, apiBase])

  function openForm(c?: CostRow) {
    if (c) {
      setEditingId(c.id)
      setForm({ costComponent: c.costComponent, vendorId: c.vendorId, currency: c.currency, cost: String(c.cost) })
    } else {
      setEditingId(null)
      setForm(EMPTY_FORM)
    }
    setPreview(null); setError(null)
    setShowForm(true)
  }

  async function afterChange() {
    await loadCosts()
    await onChanged?.()
  }

  async function save() {
    setSaving(true); setError(null)
    const body = { costComponent: form.costComponent, vendorId: form.vendorId, currency: form.currency, cost: Number(form.cost) }
    const r = await fetch(editingId ? `${apiBase}/${editingId}` : apiBase, {
      method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!r.ok) {
      const j: { error?: string } | null = await r.json().catch(() => null)
      setError(j?.error ?? 'Komponen biaya gagal disimpan.')
      setSaving(false)
      return
    }
    await afterChange()
    setSaving(false); setShowForm(false)
  }

  async function remove(costId: string) {
    if (!confirm('Hapus komponen biaya ini?')) return
    setError(null)
    const r = await fetch(`${apiBase}/${costId}`, { method: 'DELETE' })
    if (!r.ok) {
      const j: { error?: string } | null = await r.json().catch(() => null)
      setError(j?.error ?? 'Komponen biaya gagal dihapus.')
      return
    }
    await afterChange()
  }

  if (forbidden) {
    return (
      <div className="admin-form-panel space-y-2">
        <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-4 w-4" /> Komponen Biaya</p>
        <p role="status" className="text-[12px] text-admin-muted">Komponen biaya (HPP) hanya dapat dilihat dan diubah oleh superadmin.</p>
      </div>
    )
  }

  const total = costs.reduce((sum, c) => sum + (c.sellPrice ?? 0), 0)

  return (
    <div className="admin-form-panel space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><Wallet className="h-4 w-4" /> Komponen Biaya</p>
          <p className="text-[11px] text-admin-muted/70 mt-0.5">{hint}</p>
        </div>
        <button onClick={() => openForm()} className="admin-btn-sm flex items-center gap-1 shrink-0"><Plus className="h-3.5 w-3.5" /> Tambah</button>
      </div>

      {error && <p role="alert" className="text-[12px] font-medium text-admin-danger">{error}</p>}

      {showForm && (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-admin-muted mb-1">Nama Komponen</p>
            <input className="admin-inp" placeholder={namePlaceholder}
              value={form.costComponent} onChange={e => setForm(f => ({ ...f, costComponent: e.target.value }))} />
          </div>

          <VendorCurrencyField
            vendorId={form.vendorId} currency={form.currency} currencies={CURRENCIES}
            onVendorChange={vendorId => setForm(f => ({ ...f, vendorId }))}
            onCurrencyChange={currency => setForm(f => ({ ...f, currency }))}
          />

          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div>
              <p className="text-xs text-admin-muted mb-1">Biaya ({form.currency})</p>
              <input className="admin-inp" type="number" placeholder="0"
                value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} />
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">HPP (Rupiah)</p>
              <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink">{preview ? rupiah(preview.hppRupiah) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-admin-muted mb-1">Harga Jual (otomatis)</p>
              <p className="admin-inp bg-admin-spot/50 font-semibold text-admin-ink">{preview ? rupiah(preview.sellPrice) : '—'}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !form.costComponent || !form.vendorId || !form.cost}
              className="admin-btn-sm disabled:opacity-50 flex items-center gap-1.5">
              <Save className="h-3.5 w-3.5" /> {saving ? 'Menyimpan...' : 'Simpan Komponen'}
            </button>
            <button onClick={() => setShowForm(false)} className="admin-btn-ghost text-sm">Batal</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {costs.map(c => (
          <div key={c.id} className="flex items-center justify-between rounded-lg border border-admin-line px-4 py-2.5">
            <div>
              <p className="text-[13px] font-medium text-admin-ink">{c.costComponent}</p>
              <p className="text-[11px] text-admin-muted">{c.vendorName} · {c.currency} {c.cost.toLocaleString('id-ID')}{c.hppRupiah != null && ` · HPP ${rupiah(c.hppRupiah)}`}</p>
            </div>
            <div className="flex items-center gap-3">
              {c.sellPrice != null && <p className="text-[13px] font-bold text-admin-accent-strong">{rupiah(c.sellPrice)}</p>}
              <div className="flex items-center gap-1.5">
                <button onClick={() => openForm(c)} aria-label={`Ubah ${c.costComponent}`} className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-ink hover:bg-admin-spot transition-colors">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => remove(c.id)} aria-label={`Hapus ${c.costComponent}`} className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {costs.length === 0 && <p className="text-sm text-admin-muted/70 py-2">Belum ada komponen biaya.</p>}
        {costs.length > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-admin-spot/40 px-4 py-2">
            <span className="text-[12px] font-semibold text-admin-ink">Total Komponen</span>
            <span className="text-[13px] font-bold text-admin-accent-strong">{rupiah(total)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
