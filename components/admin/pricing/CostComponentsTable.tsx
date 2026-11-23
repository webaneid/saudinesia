'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Plus, Wallet } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { FormField } from '@/components/admin/ui/FormField'
import { Modal } from '@/components/admin/ui/Modal'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { KindButton, RowActions } from '@/components/shared/data-table/RowActions'
import { marginNote } from '@/lib/pricing/marginNote'
import { formatRupiah } from '@/lib/utils'
import { MarginNote } from './MarginNote'
import { SellPriceWarnings } from './SellPriceWarnings'
import { CostFields, ProfitText, emptyCost, manualSellOf, syncManualSell, useCostPreview, type CostValue } from './CostFields'

// Komponen Biaya sebagai TABEL + popup (menggantikan CostComponentsPanel kartu, 2026-11-24) — SATU komponen untuk Paket Umroh, Paket Ziarah, Haji (docs/arsitektur-komponen-biaya.md §10).
// Satu baris = satu komponen: Biaya (mata uang vendor) → HPP Rupiah (otomatis, server) → Harga Jual (rekomendasi, bisa diubah = harga manual
// komponen lewat route titik harga yang sama dengan PriceCard) → Untung (jual − HPP). Peringatan lewat SellPriceWarnings (sama dengan PriceCard).
// Route yang dipakai sama dengan panel lama: `apiBase` (GET/POST), `/<id>` (PUT/DELETE), `/simulate`; harga manual `/api/v1/admin/pricing/points`.

/** `price` = titik harga komponen (§22 docs/arsitektur-harga-terpadu.md) — null bila belum ada (mis. kurs belum tersedia). */
type ComponentPrice = { autoSellIdr: number | null; sellIdr: number; mode: 'auto' | 'manual'; manualNote: string | null }
type CostRow = { id: string; costComponent: string; vendorId: string; vendorName: string; currency: string; cost: number; hppRupiah: number | null; sellPrice: number | null; price: ComponentPrice | null }
type Dialog = { kind: 'form'; id: string | null } | { kind: 'view'; row: CostRow }

const CURRENCIES = ['IDR', 'SAR', 'USD', 'EUR'] as const

const rp = (n: number | null | undefined) => (n == null ? '—' : formatRupiah(Math.round(n)))
const money = (currency: string, n: number) => (currency === 'IDR' ? formatRupiah(n) : `${currency} ${n.toLocaleString('id-ID')}`)

type Props = {
  /** Awalan route komponen biaya, mis. `/api/v1/admin/products/haji/<id>/costs`. */
  apiBase: string
  /** Kalimat penjelas di bawah judul. */
  hint: ReactNode
  /** Contoh nama komponen pada input. */
  namePlaceholder: string
  /** Dipanggil setelah komponen ditambah/diubah/dihapus — induk memuat ulang ringkasan harganya. */
  onChanged?: () => void | Promise<void>
}

export function CostComponentsTable({ apiBase, hint, namePlaceholder, onChanged }: Props) {
  const { ask, dialog: confirmDialog } = useConfirm()
  const [costs, setCosts] = useState<CostRow[] | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [marginPercent, setMarginPercent] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [name, setName] = useState('')
  const [form, setForm] = useState<CostValue>(emptyCost())
  const [wasManual, setWasManual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(apiBase)
    // HPP dan komponen biaya hanya untuk superadmin — manager harus diberi tahu, bukan melihat daftar kosong.
    setForbidden(r.status === 401 || r.status === 403)
    const j = await r.json().catch(() => null)
    setCosts(j?.data ?? [])
    setMarginPercent(Number(j?.meta?.marginPercent ?? 0))
  }, [apiBase])

  useEffect(() => { void load() }, [load])

  // Pratinjau HPP → rekomendasi dari angka yang sedang diketik (margin tipe pemilik — server).
  const formOpen = dialog?.kind === 'form'
  const costNum = Number(form.cost)
  const preview = useCostPreview(formOpen && costNum > 0 ? `${apiBase}/simulate?${new URLSearchParams({ cost: String(costNum), currency: form.currency })}` : null)

  function openForm(c?: CostRow) {
    const manual = c?.price?.mode === 'manual'
    setName(c?.costComponent ?? '')
    setForm(c ? { vendorId: c.vendorId, currency: c.currency, cost: String(c.cost), sell: manual ? String(c.price!.sellIdr) : '', sellEdited: manual, note: manual ? c.price!.manualNote ?? '' : '' } : emptyCost())
    setWasManual(manual); setError(null)
    setDialog({ kind: 'form', id: c?.id ?? null })
  }


  async function afterChange() {
    await load()
    await onChanged?.()
  }

  async function save() {
    if (dialog?.kind !== 'form') return
    const editingId = dialog.id
    setSaving(true); setError(null)
    const r = await fetch(editingId ? `${apiBase}/${editingId}` : apiBase, {
      method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ costComponent: name.trim(), vendorId: form.vendorId, currency: form.currency, cost: Number(form.cost) }),
    })
    const j: { data?: { id?: string }; error?: string } | null = await r.json().catch(() => null)
    if (!r.ok) { setError(j?.error ?? 'Komponen biaya gagal disimpan.'); setSaving(false); return }

    // Harga jual komponen (§22): angka diubah dari rekomendasi = harga manual; sama/kosong = ikut rekomendasi. Route sama dengan PriceCard.
    const costId = editingId ?? j?.data?.id
    const failed = costId ? await syncManualSell({ ownerType: 'cost_component', ownerId: costId, manual: manualSellOf(form, preview), wasManual, note: form.note }) : null
    const priceError = failed ? `Komponen tersimpan, tetapi harga jual gagal disimpan: ${failed}` : null
    await afterChange()
    setSaving(false)
    if (priceError) {
      setError(priceError)
      if (costId) { setDialog({ kind: 'form', id: costId }); setWasManual(false) }
      return
    }
    setDialog(null)
  }

  async function remove(c: CostRow) {
    if (!(await ask({ title: `Hapus komponen "${c.costComponent}"?`, body: 'Komponen dihapus dari perhitungan HPP; harga jual produk dihitung ulang.' }))) return
    setListError(null)
    const r = await fetch(`${apiBase}/${c.id}`, { method: 'DELETE' })
    if (!r.ok) {
      const j: { error?: string } | null = await r.json().catch(() => null)
      setListError(j?.error ?? 'Komponen biaya gagal dihapus.')
      return
    }
    await afterChange()
  }

  const head = (action?: ReactNode) => (
    <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
      <div className="min-w-0">
        <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><Wallet className="size-4 text-admin-accent" /> Komponen Biaya</h2>
        <p className="m-0 mt-1 text-xs text-admin-muted">{hint}</p>
      </div>
      {action}
    </div>
  )

  if (forbidden) {
    return <Card className="space-y-3 p-5">{head()}<p role="status" className="m-0 text-xs text-admin-muted">Komponen biaya (HPP) hanya dapat dilihat dan diubah oleh superadmin.</p></Card>
  }

  // Jual BERLAKU per komponen (harga manual komponen menang); rekomendasi = HPP × margin.
  const sellOf = (c: CostRow) => c.price?.sellIdr ?? c.sellPrice
  const recOf = (c: CostRow) => c.price?.autoSellIdr ?? c.sellPrice
  const rows = (costs ?? []).map((c, i) => ({ ...c, i }))
  const totalHpp = rows.every(c => c.hppRupiah != null) ? rows.reduce((s, c) => s + (c.hppRupiah ?? 0), 0) : null
  const totalSell = rows.reduce((s, c) => s + (sellOf(c) ?? 0), 0)

  const columns: Column<CostRow & { i: number }>[] = [
    { key: 'no', header: '#', cell: c => <span className="tabular-nums text-admin-muted">{c.i + 1}</span> },
    {
      key: 'name', header: 'Komponen', mobile: 'title',
      cell: c => (
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-center gap-1.5 font-semibold text-admin-ink">{c.costComponent} {c.price?.mode === 'manual' && <Badge tone="warning">Manual</Badge>}</p>
          <p className="m-0 mt-0.5 text-xs text-admin-muted">{c.vendorName}</p>
        </div>
      ),
    },
    {
      key: 'cost', header: 'Biaya → HPP', align: 'right',
      cell: c => (
        <div className="text-right">
          <p className="m-0 whitespace-nowrap tabular-nums text-xs text-admin-ink">{money(c.currency, c.cost)}</p>
          {c.currency !== 'IDR' && <p className="m-0 whitespace-nowrap tabular-nums text-[11px] text-admin-muted">{rp(c.hppRupiah)}</p>}
        </div>
      ),
    },
    {
      key: 'sell', header: 'Harga Jual', align: 'right',
      cell: c => (
        <div className="text-right">
          <p className="m-0 whitespace-nowrap font-semibold tabular-nums text-admin-accent-strong">{rp(sellOf(c))}</p>
          {c.price?.mode === 'manual' && recOf(c) != null && <p className="m-0 whitespace-nowrap text-[11px] text-admin-muted">rekomendasi {rp(recOf(c))}</p>}
        </div>
      ),
    },
    { key: 'profit', header: 'Untung', align: 'right', cell: c => <ProfitText sell={sellOf(c)} cost={c.hppRupiah} stacked /> },
    {
      key: 'actions', header: '', actions: true,
      cell: c => (
        <RowActions>
          <KindButton kind="view" label={`Lihat ${c.costComponent}`} onClick={() => setDialog({ kind: 'view', row: c })} />
          <KindButton kind="edit" label={`Edit ${c.costComponent}`} onClick={() => openForm(c)} />
          <KindButton kind="delete" label={`Hapus ${c.costComponent}`} onClick={() => { void remove(c) }} />
        </RowActions>
      ),
    },
  ]

  const view = dialog?.kind === 'view' ? dialog.row : null
  const viewSell = view ? sellOf(view) : null
  const viewNote = view && view.price?.mode === 'manual' && viewSell != null ? marginNote({ sell: viewSell, recommended: recOf(view), ref: 'margin', marginPercent }) : null

  return (
    <Card className="space-y-4 p-5">
      {head(<Button type="button" size="sm" className="shrink-0" onClick={() => openForm()} disabled={costs === null}><Plus className="size-3.5" /> Tambah komponen</Button>)}
      {listError && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{listError}</p>}

      <DataTable
        columns={columns} rows={rows} getRowId={c => c.id} loading={costs === null}
        empty="Belum ada komponen biaya — produk belum berharga sampai ada komponen."
        footer={rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-xs">
            <span className="mr-auto font-bold uppercase tracking-[0.1em] text-admin-muted">Total</span>
            <span className="text-admin-muted">HPP <b className="tabular-nums text-admin-ink">{rp(totalHpp)}</b></span>
            <span className="text-admin-muted">Harga jual <b className="tabular-nums text-admin-accent-strong">{rp(totalSell)}</b></span>
            <span className="text-admin-muted">Untung <ProfitText sell={totalSell} cost={totalHpp} strong /></span>
          </div>
        )}
      />

      {/* Popup tambah / edit */}
      <Modal open={formOpen} title={dialog?.kind === 'form' && dialog.id ? 'Edit komponen biaya' : 'Tambah komponen biaya'} onClose={() => setDialog(null)}>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save() }}>
          <CostFields
            value={form} onChange={v => { setError(null); setForm(v) }} preview={preview} marginPercent={marginPercent} currencies={CURRENCIES}
            vendorContext="costComponent" idPrefix="cc"
            before={(
              <FormField label="Nama komponen" htmlFor="cc-name" required>
                <input id="cc-name" className="admin-input" maxLength={120} placeholder={namePlaceholder} value={name} onChange={e => { setError(null); setName(e.target.value) }} />
              </FormField>
            )}
          />

          {error && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-admin-line pt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => setDialog(null)}>Batal</Button>
            <Button type="submit" size="sm" loading={saving} disabled={!name.trim() || !form.vendorId || !(Number(form.cost) > 0)}>
              {dialog?.kind === 'form' && dialog.id ? 'Simpan perubahan' : 'Tambahkan'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Popup lihat */}
      <Modal open={!!view} title={view?.costComponent ?? ''} onClose={() => setDialog(null)}>
        {view && (
          <div className="space-y-4">
            <dl className="m-0 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {([
                ['Vendor', view.vendorName],
                ['Biaya', money(view.currency, view.cost)],
                ['HPP (Rupiah)', rp(view.hppRupiah)],
                ['Harga Jual Rekomendasi', rp(recOf(view))],
                ['Harga jual berlaku', <span key="s" className="font-semibold text-admin-accent-strong">{rp(viewSell)} {view.price?.mode === 'manual' && <Badge tone="warning">Manual</Badge>}</span>],
                ['Untung', <ProfitText key="p" sell={viewSell} cost={view.hppRupiah} strong />],
              ] as const).map(([k, v]) => (
                <div key={k}>
                  <dt className="label-kecil">{k}</dt>
                  <dd className="m-0 mt-0.5 text-admin-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {view.price?.mode === 'manual' && view.price.manualNote && <p className="m-0 text-xs text-admin-muted">Catatan: “{view.price.manualNote}”</p>}
            {viewSell != null && view.hppRupiah != null && viewSell < view.hppRupiah
              ? <SellPriceWarnings sell={viewSell} cost={view.hppRupiah} recommended={recOf(view)} marginPercent={marginPercent} />
              : viewNote && <MarginNote note={viewNote} />}
            <div className="flex justify-end gap-2 border-t border-admin-line pt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => setDialog(null)}>Tutup</Button>
              <Button type="button" size="sm" onClick={() => openForm(view)}>Edit</Button>
            </div>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </Card>
  )
}
