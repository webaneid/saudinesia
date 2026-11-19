'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Pencil, Plus, Save, Trash2, Wallet } from 'lucide-react'
import { VendorCurrencyField } from './VendorCurrencyField'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { MarginNote } from './MarginNote'
import { Badge } from '@/components/admin/ui/Badge'
import { marginNote } from '@/lib/pricing/marginNote'

/** `price` = titik harga komponen (§22 docs/arsitektur-harga-terpadu.md): rekomendasi, jual BERLAKU, mode — null bila belum ada (mis. kurs belum tersedia). */
type ComponentPrice = { autoSellIdr: number | null; sellIdr: number; mode: 'auto' | 'manual'; manualNote: string | null }
type CostRow = { id: string; costComponent: string; vendorId: string; vendorName: string; currency: string; cost: number; hppRupiah: number | null; sellPrice: number | null; price: ComponentPrice | null }
type Preview = { hppRupiah: number; sellPrice: number }

const CURRENCIES = ['IDR', 'SAR', 'USD', 'EUR'] as const
const EMPTY_FORM = { costComponent: '', vendorId: '', currency: 'IDR', cost: '', sell: '', note: '' }

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
  const { ask, dialog } = useConfirm()
  const [costs, setCosts] = useState<CostRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [wasManual, setWasManual] = useState(false)
  const [sellEdited, setSellEdited] = useState(false) // false = kotak Harga Jual Rekomendasi menampilkan rekomendasi (belum disentuh)
  const [formOpenedAt, setFormOpenedAt] = useState(0)
  const [marginPercent, setMarginPercent] = useState(0)

  const loadCosts = useCallback(async () => {
    const r = await fetch(apiBase)
    // HPP dan komponen biaya hanya untuk superadmin (seluruh endpoint biaya) — manager yang membuka halaman produk harus diberi tahu, bukan
    // melihat daftar kosong yang seolah "belum ada komponen".
    setForbidden(r.status === 401 || r.status === 403)
    const j = await r.json().catch(() => null)
    setCosts(j?.data ?? [])
    setMarginPercent(Number(j?.meta?.marginPercent ?? 0))
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
  }, [form.cost, form.currency, apiBase, formOpenedAt]) // formOpenedAt: buka ulang dengan biaya sama tetap memuat pratinjau

  function openForm(c?: CostRow) {
    if (c) {
      setEditingId(c.id)
      const manual = c.price?.mode === 'manual'
      setForm({
        costComponent: c.costComponent, vendorId: c.vendorId, currency: c.currency, cost: String(c.cost),
        sell: manual ? String(c.price!.sellIdr) : '', note: manual ? c.price!.manualNote ?? '' : '',
      })
      setWasManual(manual); setSellEdited(manual)
    } else {
      setEditingId(null)
      setForm(EMPTY_FORM)
      setWasManual(false); setSellEdited(false)
    }
    setPreview(null); setError(null); setFormOpenedAt(n => n + 1)
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
    const j: { data?: { id?: string }; error?: string } | null = await r.json().catch(() => null)
    if (!r.ok) {
      setError(j?.error ?? 'Komponen biaya gagal disimpan.')
      setSaving(false)
      return
    }
    // Harga jual komponen (§22): kotak "Harga Jual Rekomendasi" diubah ke angka lain = harga manual; tak diubah / dikosongkan / sama dengan
    // rekomendasi = ikut rekomendasi. Lewat route harga yang sama dengan PriceCard.
    const costId = editingId ?? j?.data?.id
    const sell = Number(form.sell)
    const manual = manualSell
    let priceError: string | null = null
    if (costId && (manual || wasManual)) {
      const pr = await fetch('/api/v1/admin/pricing/points', {
        method: manual ? 'PUT' : 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'cost_component', ownerId: costId, variantKey: '', ...(manual ? { sellIdr: sell, note: form.note.trim() || null } : {}) }),
      })
      if (!pr.ok) {
        const pj: { error?: string } | null = await pr.json().catch(() => null)
        priceError = `Komponen tersimpan, tetapi harga jual gagal disimpan: ${pj?.error ?? 'coba lagi.'}`
      }
    }
    await afterChange()
    setSaving(false)
    if (priceError) {
      setError(priceError)
      if (costId) { setEditingId(costId); setWasManual(false) }
      return
    }
    setShowForm(false)
  }

  async function remove(costId: string) {
    if (!(await ask({ title: 'Hapus komponen biaya ini?', body: 'Komponen dihapus dari perhitungan HPP; harga jual dihitung ulang.' }))) return
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

  // Jual BERLAKU per komponen (harga manual komponen menang); rekomendasi = HPP × margin. Total = harga otomatis produk dari komponen (§22).
  const sellOf = (c: CostRow) => c.price?.sellIdr ?? c.sellPrice
  const recOf = (c: CostRow) => c.price?.autoSellIdr ?? c.sellPrice
  const total = costs.reduce((sum, c) => sum + (sellOf(c) ?? 0), 0)
  const manualSell = sellEdited && form.sell.trim() !== '' && Number(form.sell) > 0 && Number(form.sell) !== preview?.sellPrice
  const typedSell = manualSell ? Number(form.sell) : 0
  const belowCost = preview != null && typedSell > 0 && typedSell < preview.hppRupiah
  const formNote = typedSell > 0 && !belowCost ? marginNote({ sell: typedSell, recommended: preview?.sellPrice ?? null, ref: 'margin', marginPercent }) : null

  return (
    <div className="admin-form-panel space-y-4">
      {dialog}
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

          <div className="grid sm:grid-cols-3 gap-3 items-end">
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
              <p className="text-xs text-admin-muted mb-1">Harga Jual Rekomendasi <span className="font-normal">(bisa diubah)</span></p>
              <input className="admin-inp font-semibold text-admin-ink" type="number" min={0} aria-label="Harga Jual Rekomendasi — bisa diubah"
                placeholder={preview ? String(preview.sellPrice) : 'Isi biaya dulu'}
                value={sellEdited ? form.sell : preview ? String(preview.sellPrice) : ''}
                onChange={e => { setSellEdited(true); setForm(f => ({ ...f, sell: e.target.value })) }} />
            </div>
          </div>
          {manualSell && preview && (
            <p className="m-0 flex flex-wrap items-center gap-2 text-[11px] text-admin-muted">
              Harga manual · rekomendasi {rupiah(preview.sellPrice)}
              <button type="button" className="font-semibold text-admin-accent underline" onClick={() => { setSellEdited(false); setForm(f => ({ ...f, sell: '', note: '' })) }}>
                Kembalikan ke rekomendasi
              </button>
            </p>
          )}
          {typedSell > 0 && (
            <div className="space-y-2">
              {belowCost && preview && (
                <p className="m-0 flex items-start gap-1.5 text-xs font-medium text-admin-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Di bawah modal ({rupiah(preview.hppRupiah)}) — rugi {rupiah(preview.hppRupiah - typedSell)} per satuan. Peringatan internal; tetap bisa disimpan.
                </p>
              )}
              {formNote && <MarginNote note={formNote} />}
              <input className="admin-inp" maxLength={500} aria-label="Catatan harga jual" placeholder="Catatan harga jual (opsional), mis. nego vendor, promo musim"
                value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>
          )}
          <p className="m-0 text-[11px] text-admin-muted">
            Angka awal = rekomendasi (modal + margin bawaan {marginPercent}%). Ubah angkanya untuk harga jual sendiri; selisihnya terhadap margin hanya ditandai, tetap bisa disimpan.
          </p>

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
        {costs.map(c => {
          const sell = sellOf(c), rec = recOf(c), manual = c.price?.mode === 'manual'
          const saved = manual && sell != null && (c.hppRupiah == null || sell >= c.hppRupiah) ? marginNote({ sell, recommended: rec, ref: 'margin', marginPercent }) : null
          return (
            <div key={c.id} className="space-y-2 rounded-lg border border-admin-line px-4 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-admin-ink">
                    {c.costComponent} {manual && <Badge tone="warning">Manual</Badge>}
                  </p>
                  <p className="text-[11px] text-admin-muted">{c.vendorName} · {c.currency} {c.cost.toLocaleString('id-ID')}{c.hppRupiah != null && ` · HPP ${rupiah(c.hppRupiah)}`}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    {sell != null && <p className="text-[13px] font-bold text-admin-accent-strong">{rupiah(sell)}</p>}
                    {manual && rec != null && <p className="text-[11px] text-admin-muted">rekomendasi {rupiah(rec)}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => openForm(c)} aria-label={`Ubah ${c.costComponent} dan harga jualnya`} title="Ubah komponen & harga jual" className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-ink hover:bg-admin-spot transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(c.id)} aria-label={`Hapus ${c.costComponent}`} className="h-7 w-7 rounded-lg grid place-items-center text-admin-muted/70 hover:text-admin-danger/80 hover:bg-admin-danger/10 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              {manual && c.price?.manualNote && <p className="text-[11px] text-admin-muted">Catatan: “{c.price.manualNote}”</p>}
              {saved && <MarginNote note={saved} />}
            </div>
          )
        })}
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
