'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, Plus, Settings2 } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { FormField } from '@/components/admin/ui/FormField'
import { Modal } from '@/components/admin/ui/Modal'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { VendorPicker } from '@/components/admin/vendor/VendorPicker'
import { CostFields, ProfitText, emptyCost, manualSellOf, syncManualSell, useCostPreview, type CostValue } from '@/components/admin/pricing/CostFields'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { KindButton, RowActions } from '@/components/shared/data-table/RowActions'
import { CurrencySelect } from '@/components/shared/CurrencySelect'
import { formatRupiah } from '@/lib/utils'

// Harga Visa per RENTANG HARI sebagai TABEL + popup (docs/arsitektur-komponen-biaya.md §10.1, docs/arsitektur-visa.md §3). Satu baris = satu tier
// (varian titik harga `days:<min>-<max>`). Isian popup = CostFields + isian khas visa: rentang hari dan biaya BRN (opsional). Vendor + mata uang Visa
// dan BRN SATU untuk semua rentang (dua komponen `ProductCost`): dikunci di popup bila rentang lain sudah ada, diubah lewat popup "Vendor & mata uang".
// Simpan = PUT cost-tiers berisi SEMUA rentang (route mengganti seluruhnya), lalu harga jual manual varian lewat route titik harga (`syncManualSell`).

type Tier = { id: string; minDays: number; maxDays: number; hargaVisa: number; hargaBrn: number | null }
type CostSide = { vendorId: string; vendorName: string; currency: string }
type PointInfo = { variantKey: string; costIdr: number | null; sellIdr: number; autoSellIdr: number | null; mode: 'auto' | 'manual'; manualNote: string | null }
type Row = Tier & { point: PointInfo | null }
type Dialog = { kind: 'form'; row: Row | null } | { kind: 'view'; row: Row } | { kind: 'vendors' }

const CURRENCIES = ['USD', 'SAR', 'EUR', 'IDR'] as const
const keyOf = (minDays: number, maxDays: number) => `days:${minDays}-${maxDays}`
const rp = (n: number | null | undefined) => (n == null ? '—' : formatRupiah(Math.round(n)))
const money = (currency: string, n: number) => (currency === 'IDR' ? formatRupiah(n) : `${currency} ${n.toLocaleString('id-ID')}`)
const rangeText = (t: { minDays: number; maxDays: number }) => (t.minDays === t.maxDays ? `${t.minDays} hari` : `${t.minDays}–${t.maxDays} hari`)
const tierBody = (t: Tier) => ({ id: t.id, minDays: t.minDays, maxDays: t.maxDays, hargaVisa: t.hargaVisa, hargaBrn: t.hargaBrn })

type Form = { minDays: string; maxDays: string; cost: CostValue; brnCost: string; brnVendorId: string; brnCurrency: string }

export function VisaTiersTable({ productId, onChanged, reloadKey = 0 }: { productId: string; onChanged: () => void | Promise<void>; reloadKey?: number }) {
  const { ask, dialog: confirmDialog } = useConfirm()
  const api = `/api/v1/admin/products/visa/${productId}/cost-tiers`
  const [rows, setRows] = useState<Row[] | null>(null)
  const [visa, setVisa] = useState<CostSide | null>(null)
  const [brn, setBrn] = useState<CostSide | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [marginPercent, setMarginPercent] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [form, setForm] = useState<Form>({ minDays: '', maxDays: '', cost: emptyCost('USD'), brnCost: '', brnVendorId: '', brnCurrency: 'USD' })
  const [vendors, setVendors] = useState({ visaVendorId: '', visaCurrency: 'USD', brnVendorId: '', brnCurrency: 'USD' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      fetch(api).then(async r => ({ status: r.status, j: await r.json().catch(() => null) })).catch(() => null),
      fetch(`/api/v1/admin/pricing/points?${new URLSearchParams({ ownerType: 'visa', ownerId: productId })}`).then(r => r.json()).catch(() => null),
    ])
    // HPP dan vendor hanya untuk superadmin — manager diberi tahu, bukan melihat tabel kosong.
    setForbidden(c?.status === 401 || c?.status === 403)
    const d = c?.j?.data as { visa: CostSide | null; brn: CostSide | null; rows: Tier[] } | undefined
    if (p?.data?.rule?.marginPercent != null) setMarginPercent(Number(p.data.rule.marginPercent))
    const points = (p?.data?.points ?? []) as PointInfo[]
    setVisa(d?.visa ?? null); setBrn(d?.brn ?? null)
    setRows([...(d?.rows ?? [])].sort((a, b) => a.minDays - b.minDays).map(t => ({ ...t, point: points.find(x => x.variantKey === keyOf(t.minDays, t.maxDays)) ?? null })))
  }, [api, productId])

  useEffect(() => { void load() }, [load, reloadKey])

  const formOpen = dialog?.kind === 'form'
  const editing = dialog?.kind === 'form' ? dialog.row : null
  const others = (rows ?? []).filter(r => r.id !== editing?.id)
  const visaLocked = !!visa && others.length > 0
  const brnLocked = !!brn && others.some(r => r.hargaBrn != null)
  const brnCurrency = brnLocked ? brn!.currency : form.brnCurrency
  const costNum = Number(form.cost.cost)
  const brnNum = Number(form.brnCost)
  const preview = useCostPreview(formOpen && costNum > 0 ? `/api/v1/admin/products/visa/simulate?${new URLSearchParams({
    visaCost: String(costNum), visaCurrency: form.cost.currency, ...(brnNum > 0 ? { brnCost: String(brnNum), brnCurrency } : {}),
  })}` : null)

  function openForm(row: Row | null) {
    const manual = row?.point?.mode === 'manual'
    const last = rows?.at(-1)
    setForm({
      minDays: row ? String(row.minDays) : last ? String(last.maxDays + 1) : '1',
      maxDays: row ? String(row.maxDays) : '',
      cost: {
        vendorId: visa?.vendorId ?? '', currency: visa?.currency ?? 'USD', cost: row ? String(row.hargaVisa) : '',
        sell: manual ? String(row!.point!.sellIdr) : '', sellEdited: manual, note: manual ? row!.point!.manualNote ?? '' : '',
      },
      brnCost: row?.hargaBrn != null ? String(row.hargaBrn) : '', brnVendorId: brn?.vendorId ?? '', brnCurrency: brn?.currency ?? 'USD',
    })
    setError(null)
    setDialog({ kind: 'form', row })
  }

  function openVendors() {
    setVendors({ visaVendorId: visa?.vendorId ?? '', visaCurrency: visa?.currency ?? 'USD', brnVendorId: brn?.vendorId ?? '', brnCurrency: brn?.currency ?? 'USD' })
    setError(null)
    setDialog({ kind: 'vendors' })
  }

  /** PUT seluruh rentang (route mengganti semuanya). Mengembalikan pesan galat atau null. */
  async function putTiers(tiers: Tier[], v: { vendorId: string; currency: string }, b: { vendorId: string; currency: string } | null): Promise<string | null> {
    const r = await fetch(api, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visa: v, brn: b, rows: tiers.map(tierBody) }),
    }).catch(() => null)
    if (r?.ok) return null
    const j: { error?: string } | null = await r?.json().catch(() => null) ?? null
    return j?.error ?? 'Harga visa gagal disimpan.'
  }

  async function saveTier() {
    if (dialog?.kind !== 'form') return
    const minDays = Number(form.minDays), maxDays = Number(form.maxDays)
    if (!(minDays >= 1) || !(maxDays >= minDays)) { setError('Rentang hari tidak valid: minimal 1 hari dan hari akhir tidak boleh lebih kecil dari hari awal.'); return }
    const clash = others.find(o => minDays <= o.maxDays && maxDays >= o.minDays)
    if (clash) { setError(`Rentang ini bertumpuk dengan rentang ${rangeText(clash)}.`); return }
    const hasBrn = brnNum > 0
    if (hasBrn && !brnLocked && !form.brnVendorId) { setError('Pilih vendor BRN.'); return }
    const tier: Tier = { id: editing?.id ?? crypto.randomUUID(), minDays, maxDays, hargaVisa: costNum, hargaBrn: hasBrn ? brnNum : null }
    const tiers = [...others, tier].sort((a, b) => a.minDays - b.minDays)
    const brnSide = brnLocked ? { vendorId: brn!.vendorId, currency: brn!.currency } : hasBrn ? { vendorId: form.brnVendorId, currency: form.brnCurrency } : brn
    setSaving(true); setError(null)
    const failed = await putTiers(tiers, { vendorId: form.cost.vendorId, currency: form.cost.currency }, brnSide ? { vendorId: brnSide.vendorId, currency: brnSide.currency } : null)
    if (failed) { setError(failed); setSaving(false); return }
    // Harga jual manual menempel pada varian rentang ini; rentang berubah → varian lama hilang, harga manual (bila ada) dipasang di varian baru.
    const key = keyOf(minDays, maxDays)
    const sameKey = !!editing && keyOf(editing.minDays, editing.maxDays) === key
    const priceError = await syncManualSell({ ownerType: 'visa', ownerId: productId, variantKey: key, manual: manualSellOf(form.cost, preview), wasManual: sameKey && editing?.point?.mode === 'manual', note: form.cost.note })
    await load(); await onChanged()
    setSaving(false)
    if (priceError) { setError(`Rentang tersimpan, tetapi harga jual gagal disimpan: ${priceError}`); return }
    setDialog(null)
  }

  async function saveVendors() {
    if (!rows?.length || !vendors.visaVendorId) return
    const brnUsed = rows.some(r => r.hargaBrn != null)
    if (brnUsed && !vendors.brnVendorId) { setError('Pilih vendor BRN.'); return }
    setSaving(true); setError(null)
    const failed = await putTiers(rows, { vendorId: vendors.visaVendorId, currency: vendors.visaCurrency }, brnUsed ? { vendorId: vendors.brnVendorId, currency: vendors.brnCurrency } : null)
    await load(); await onChanged()
    setSaving(false)
    if (failed) { setError(failed); return }
    setDialog(null)
  }

  async function removeBrn() {
    if (!rows?.length || !visa) return
    if (!(await ask({ title: 'Hapus BRN dari semua rentang?', body: 'Biaya BRN dikosongkan di setiap rentang hari; HPP dan harga jual dihitung ulang tanpa BRN.' }))) return
    setSaving(true); setError(null)
    const failed = await putTiers(rows.map(r => ({ ...r, hargaBrn: null })), { vendorId: visa.vendorId, currency: visa.currency }, null)
    await load(); await onChanged()
    setSaving(false)
    if (failed) { setError(failed); return }
    setDialog(null)
  }

  async function remove(row: Row) {
    if (!rows || !visa) return
    if (rows.length === 1) { setListError('Minimal satu rentang hari. Ubah rentang ini, atau nonaktifkan produk bila visa tidak dijual.'); return }
    if (!(await ask({ title: `Hapus rentang ${rangeText(row)}?`, body: 'Harga untuk lama tinggal ini hilang; pesanan baru dengan lama tinggal itu tidak bisa memilih visa ini.' }))) return
    setListError(null)
    const rest = rows.filter(r => r.id !== row.id)
    const failed = await putTiers(rest, { vendorId: visa.vendorId, currency: visa.currency }, brn && rest.some(r => r.hargaBrn != null) ? { vendorId: brn.vendorId, currency: brn.currency } : null)
    if (failed) setListError(failed)
    await load(); await onChanged()
  }

  const head = (action?: React.ReactNode) => (
    <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
      <div className="min-w-0">
        <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><CalendarRange className="size-4 text-admin-accent" /> Harga per Rentang Hari</h2>
        <p className="m-0 mt-1 text-xs text-admin-muted">Satu baris = satu rentang lama tinggal. HPP = biaya visa (+ BRN bila ada) dalam Rupiah, ditambah margin jadi harga jual per orang.</p>
      </div>
      {action}
    </div>
  )
  if (forbidden) return <Card className="space-y-3 p-5">{head()}<p role="status" className="m-0 text-xs text-admin-muted">Biaya visa (HPP) hanya dapat dilihat dan diubah oleh superadmin.</p></Card>

  const sellOf = (r: Row) => r.point?.sellIdr ?? null
  const columns: Column<Row>[] = [
    {
      key: 'range', header: 'Rentang hari', mobile: 'title',
      cell: r => <p className="m-0 flex flex-wrap items-center gap-1.5 font-semibold text-admin-ink">{rangeText(r)} {r.point?.mode === 'manual' && <Badge tone="warning">Manual</Badge>}</p>,
    },
    {
      key: 'cost', header: 'Biaya → HPP', align: 'right', hideBelowLg: true,
      cell: r => (
        <div className="text-right">
          <p className="m-0 whitespace-nowrap text-xs tabular-nums text-admin-ink">{visa ? money(visa.currency, r.hargaVisa) : r.hargaVisa}{r.hargaBrn != null && brn && <span className="text-admin-muted"> + BRN {money(brn.currency, r.hargaBrn)}</span>}</p>
          <p className="m-0 whitespace-nowrap text-[11px] tabular-nums text-admin-muted">{rp(r.point?.costIdr)}</p>
        </div>
      ),
    },
    {
      key: 'sell', header: 'Harga Jual', align: 'right',
      cell: r => (
        <div className="text-right">
          <p className="m-0 whitespace-nowrap font-semibold tabular-nums text-admin-accent-strong">{rp(sellOf(r))}</p>
          {r.point?.mode === 'manual' && r.point.autoSellIdr != null && <p className="m-0 whitespace-nowrap text-[11px] text-admin-muted">rekomendasi {rp(r.point.autoSellIdr)}</p>}
        </div>
      ),
    },
    { key: 'profit', header: 'Untung', align: 'right', cell: r => <ProfitText sell={sellOf(r)} cost={r.point?.costIdr ?? null} stacked /> },
    {
      key: 'actions', header: '', actions: true,
      cell: r => (
        <RowActions>
          <KindButton kind="view" label={`Lihat rentang ${rangeText(r)}`} onClick={() => setDialog({ kind: 'view', row: r })} />
          <KindButton kind="edit" label={`Edit rentang ${rangeText(r)}`} onClick={() => openForm(r)} />
          <KindButton kind="delete" label={`Hapus rentang ${rangeText(r)}`} onClick={() => { void remove(r) }} />
        </RowActions>
      ),
    },
  ]

  const view = dialog?.kind === 'view' ? dialog.row : null
  const canSubmit = !!form.minDays && !!form.maxDays && !!form.cost.vendorId && costNum > 0
  const lockedVendor = (side: CostSide, note: string) => (
    <div>
      <div className="admin-input flex items-center bg-admin-spot/50 text-admin-ink/80">{side.vendorName}</div>
      <p className="m-0 mt-1 text-xs text-admin-muted">{note}</p>
    </div>
  )

  return (
    <Card className="space-y-4 p-5">
      {head(
        <div className="flex shrink-0 gap-2">
          {!!rows?.length && visa && <Button type="button" size="sm" variant="outline" onClick={openVendors}><Settings2 className="size-3.5" /> Vendor &amp; mata uang</Button>}
          <Button type="button" size="sm" onClick={() => openForm(null)} disabled={rows === null}><Plus className="size-3.5" /> Tambah rentang</Button>
        </div>,
      )}
      {visa && (
        <p className="m-0 text-xs text-admin-muted">
          Vendor visa: <b className="text-admin-ink">{visa.vendorName}</b> · {visa.currency}
          {brn && rows?.some(r => r.hargaBrn != null) && <> · Vendor BRN: <b className="text-admin-ink">{brn.vendorName}</b> · {brn.currency}</>}
        </p>
      )}
      {listError && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{listError}</p>}

      <DataTable columns={columns} rows={rows ?? []} getRowId={r => r.id} loading={rows === null}
        empty="Belum ada rentang hari — produk belum berharga sampai ada minimal satu rentang." />

      {/* Popup tambah / edit rentang */}
      <Modal open={formOpen} title={editing ? `Edit rentang ${rangeText(editing)}` : 'Tambah rentang hari'} onClose={() => setDialog(null)}>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void saveTier() }}>
          <CostFields
            value={form.cost} onChange={cost => { setError(null); setForm(f => ({ ...f, cost })) }} preview={preview} marginPercent={marginPercent} currencies={CURRENCIES}
            vendorContext="visa" vendorLabel="Vendor visa" costLabel="Biaya Visa" unitHint="per orang" idPrefix="vt"
            hppHint={brnNum > 0 ? 'Biaya visa + BRN × kurs terbaru.' : undefined}
            currencyLocked={visaLocked}
            {...(visaLocked ? { vendorSlot: lockedVendor(visa!, 'Satu vendor dan mata uang untuk semua rentang — ubah lewat tombol "Vendor & mata uang".') } : {})}
            before={(
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Dari hari ke-" htmlFor="vt-min" required>
                  <input id="vt-min" className="admin-input tabular-nums" inputMode="numeric" value={form.minDays} onChange={e => setForm(f => ({ ...f, minDays: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
                </FormField>
                <FormField label="Sampai hari ke-" htmlFor="vt-max" required hint="Lama tinggal jamaah yang memakai harga ini.">
                  <input id="vt-max" className="admin-input tabular-nums" inputMode="numeric" value={form.maxDays} onChange={e => setForm(f => ({ ...f, maxDays: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
                </FormField>
              </div>
            )}
            afterCost={(
              <FormField label={`Biaya BRN (${brnCurrency})`} htmlFor="vt-brn" hint="Opsional. Kosong = tanpa BRN untuk rentang ini.">
                <div className="flex gap-2">
                  {brnLocked
                    ? <span className="admin-input flex w-auto shrink-0 items-center bg-admin-spot/50 font-semibold text-admin-ink/80">{brnCurrency}</span>
                    : <CurrencySelect value={form.brnCurrency} onChange={brnCurrency => setForm(f => ({ ...f, brnCurrency }))} currencies={CURRENCIES} />}
                  <input id="vt-brn" className="admin-input min-w-0 flex-1 tabular-nums" type="number" min={0} step="any" placeholder="0" value={form.brnCost} onChange={e => { setError(null); setForm(f => ({ ...f, brnCost: e.target.value })) }} />
                </div>
              </FormField>
            )}
          />
          {brnNum > 0 && !brnLocked && (
            <FormField label="Vendor BRN" htmlFor="vt-brn-vendor" required hint="Berlaku untuk semua rentang yang memakai BRN.">
              <VendorPicker value={form.brnVendorId} onChange={brnVendorId => setForm(f => ({ ...f, brnVendorId }))} context="visa" label="Vendor BRN" />
            </FormField>
          )}
          {error && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-admin-line pt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => setDialog(null)}>Batal</Button>
            <Button type="submit" size="sm" loading={saving} disabled={!canSubmit}>{editing ? 'Simpan perubahan' : 'Tambahkan'}</Button>
          </div>
        </form>
      </Modal>

      {/* Popup vendor & mata uang (berlaku untuk semua rentang) */}
      <Modal open={dialog?.kind === 'vendors'} title="Vendor & mata uang" onClose={() => setDialog(null)}>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void saveVendors() }}>
          <p className="m-0 text-xs text-admin-muted">Berlaku untuk semua rentang hari. Mengganti mata uang tidak mengubah angka biaya — periksa lagi tiap rentang sesudahnya.</p>
          <FormField label="Vendor visa" htmlFor="vv-visa" required>
            <VendorPicker value={vendors.visaVendorId} onChange={visaVendorId => setVendors(v => ({ ...v, visaVendorId }))} context="visa" label="Vendor visa" />
          </FormField>
          <FormField label="Mata uang biaya visa" htmlFor="vv-visa-cur">
            <CurrencySelect value={vendors.visaCurrency} onChange={visaCurrency => setVendors(v => ({ ...v, visaCurrency }))} currencies={CURRENCIES} />
          </FormField>
          {rows?.some(r => r.hargaBrn != null) && <>
            <FormField label="Vendor BRN" htmlFor="vv-brn" required>
              <VendorPicker value={vendors.brnVendorId} onChange={brnVendorId => setVendors(v => ({ ...v, brnVendorId }))} context="visa" label="Vendor BRN" />
            </FormField>
            <FormField label="Mata uang biaya BRN" htmlFor="vv-brn-cur">
              <CurrencySelect value={vendors.brnCurrency} onChange={brnCurrency => setVendors(v => ({ ...v, brnCurrency }))} currencies={CURRENCIES} />
            </FormField>
            <button type="button" className="text-xs font-semibold text-admin-danger underline" onClick={() => { void removeBrn() }} disabled={saving}>Hapus BRN dari semua rentang</button>
          </>}
          {error && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-admin-line pt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => setDialog(null)}>Batal</Button>
            <Button type="submit" size="sm" loading={saving} disabled={!vendors.visaVendorId}>Simpan</Button>
          </div>
        </form>
      </Modal>

      {/* Popup lihat */}
      <Modal open={!!view} title={view ? `Rentang ${rangeText(view)}` : ''} onClose={() => setDialog(null)}>
        {view && (
          <div className="space-y-4">
            <dl className="m-0 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {([
                ['Vendor visa', visa?.vendorName ?? '—'],
                ['Biaya visa', visa ? money(visa.currency, view.hargaVisa) : '—'],
                ['Biaya BRN', view.hargaBrn != null && brn ? `${money(brn.currency, view.hargaBrn)} · ${brn.vendorName}` : '—'],
                ['HPP (Rupiah)', rp(view.point?.costIdr)],
                ['Harga Jual Rekomendasi', rp(view.point?.autoSellIdr)],
                ['Harga jual berlaku', <span key="s" className="font-semibold text-admin-accent-strong">{rp(sellOf(view))} {view.point?.mode === 'manual' && <Badge tone="warning">Manual</Badge>}</span>],
                ['Untung', <ProfitText key="p" sell={sellOf(view)} cost={view.point?.costIdr ?? null} strong />],
              ] as const).map(([k, v]) => (
                <div key={k}>
                  <dt className="label-kecil">{k}</dt>
                  <dd className="m-0 mt-0.5 text-admin-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {view.point?.mode === 'manual' && view.point.manualNote && <p className="m-0 text-xs text-admin-muted">Catatan: “{view.point.manualNote}”</p>}
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
