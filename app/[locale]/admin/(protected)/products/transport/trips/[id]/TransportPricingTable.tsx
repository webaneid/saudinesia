'use client'

import { useCallback, useEffect, useState } from 'react'
import { Car, Plus } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { FormField } from '@/components/admin/ui/FormField'
import { Modal } from '@/components/admin/ui/Modal'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { CostFields, ProfitText, emptyCost, manualSellOf, syncManualSell, useCostPreview, type CostValue } from '@/components/admin/pricing/CostFields'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { KindButton, RowActions } from '@/components/shared/data-table/RowActions'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { formatRupiah } from '@/lib/utils'

// Harga per kendaraan sebagai TABEL + popup (docs/arsitektur-komponen-biaya.md §10, sama dengan Komponen Biaya): satu baris = satu kombinasi
// rute × kendaraan (`TransportPricing`). Biaya lewat route biaya transport (superadmin), harga jual manual lewat route titik harga (`syncManualSell`).

type VehicleInfo = { id: string; name: string; vehicleType: string; capacity: number }
export type TripPricing = { id: string; vehicleId: string; price: number; isActive: boolean; vehicle: VehicleInfo }
type CostInfo = { vendorId: string; vendorName: string; currency: string; cost: number | null }
type PointInfo = { costIdr: number | null; sellIdr: number; autoSellIdr: number | null; mode: 'auto' | 'manual'; manualNote: string | null }
type Row = TripPricing & { costInfo: CostInfo | null; point: PointInfo | null }
type Dialog = { kind: 'form'; row: Row | null } | { kind: 'view'; row: Row }

const CURRENCIES = ['IDR', 'SAR', 'USD', 'EUR'] as const
const rp = (n: number | null | undefined) => (n == null ? '—' : formatRupiah(Math.round(n)))
const money = (currency: string, n: number) => (currency === 'IDR' ? formatRupiah(n) : `${currency} ${n.toLocaleString('id-ID')}`)

async function json(url: string): Promise<{ status: number; data: unknown; marginPercent?: number }> {
  const r = await fetch(url).catch(() => null)
  const j = await r?.json().catch(() => null)
  return { status: r?.status ?? 0, data: j?.data ?? null, marginPercent: j?.data?.rule?.marginPercent }
}

export function TransportPricingTable({ tripId, pricing, vehicles, onChanged }: { tripId: string; pricing: TripPricing[]; vehicles: VehicleInfo[]; onChanged: () => void | Promise<void> }) {
  const { ask, dialog: confirmDialog } = useConfirm()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [canEditCost, setCanEditCost] = useState(true)
  const [marginPercent, setMarginPercent] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [vehicleId, setVehicleId] = useState('')
  const [form, setForm] = useState<CostValue>(emptyCost())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listNotice, setListNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    let forbidden = false
    const loaded = await Promise.all(pricing.map(async p => {
      const [c, pt] = await Promise.all([
        json(`/api/v1/admin/products/transport/pricing/${p.id}/cost`),
        json(`/api/v1/admin/pricing/points?${new URLSearchParams({ ownerType: 'transport', ownerId: p.id })}`),
      ])
      if (c.status === 401 || c.status === 403) forbidden = true
      if (pt.marginPercent != null) setMarginPercent(Number(pt.marginPercent))
      const cd = c.data as { vendorId: string | null; vendorName: string | null; currency: string | null; hargaKendaraan: number | null } | null
      const points = (pt.data as { points?: Array<PointInfo & { variantKey: string }> } | null)?.points
      return {
        ...p,
        costInfo: cd?.vendorId ? { vendorId: cd.vendorId, vendorName: cd.vendorName ?? '', currency: cd.currency ?? 'IDR', cost: cd.hargaKendaraan } : null,
        point: points?.find(x => x.variantKey === '') ?? null,
      }
    }))
    setCanEditCost(!forbidden)
    setRows(loaded)
  }, [pricing])

  useEffect(() => { void load() }, [load])

  const formOpen = dialog?.kind === 'form'
  const costNum = Number(form.cost)
  const preview = useCostPreview(formOpen && costNum > 0 ? `/api/v1/admin/products/transport/simulate?${new URLSearchParams({ hargaKendaraan: String(costNum), currency: form.currency })}` : null)

  function openForm(row: Row | null) {
    const manual = row?.point?.mode === 'manual'
    setVehicleId('')
    setForm(row?.costInfo
      ? { vendorId: row.costInfo.vendorId, currency: row.costInfo.currency, cost: row.costInfo.cost ? String(row.costInfo.cost) : '', sell: manual ? String(row.point!.sellIdr) : '', sellEdited: manual, note: manual ? row.point!.manualNote ?? '' : '' }
      : { ...emptyCost(), ...(manual ? { sell: String(row!.point!.sellIdr), sellEdited: true, note: row!.point!.manualNote ?? '' } : {}) })
    setError(null)
    setDialog({ kind: 'form', row })
  }

  async function save() {
    if (dialog?.kind !== 'form') return
    setSaving(true); setError(null)
    let pricingId = dialog.row?.id ?? null
    if (!pricingId) {
      const r = await fetch('/api/v1/admin/products/transport/pricing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tripId, vehicleId }),
      }).catch(() => null)
      const j: { data?: { id?: string }; error?: string } | null = await r?.json().catch(() => null) ?? null
      if (!r?.ok || !j?.data?.id) { setError(j?.error ?? 'Kendaraan gagal ditambahkan.'); setSaving(false); return }
      pricingId = j.data.id
    }
    const r = await fetch(`/api/v1/admin/products/transport/pricing/${pricingId}/cost`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorId: form.vendorId, currency: form.currency, hargaKendaraan: costNum }),
    }).catch(() => null)
    let failed: string | null = null
    if (!r?.ok) {
      const j: { error?: string } | null = await r?.json().catch(() => null) ?? null
      failed = j?.error ?? 'Harga kendaraan gagal disimpan.'
    } else {
      const f = await syncManualSell({ ownerType: 'transport', ownerId: pricingId, manual: manualSellOf(form, preview), wasManual: dialog.row?.point?.mode === 'manual', note: form.note })
      if (f) failed = `Biaya tersimpan, tetapi harga jual gagal disimpan: ${f}`
    }
    await onChanged()
    setSaving(false)
    if (failed) { setError(failed); return }
    setDialog(null)
  }

  async function setActive(row: Row, isActive: boolean) {
    setListNotice(null)
    const j = await fetch(`/api/v1/admin/products/transport/pricing/${row.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive }),
    }).then(r => r.json()).catch(() => null)
    if (!j?.success) { setListNotice(j?.error ?? 'Gagal mengubah status kendaraan.'); return }
    await onChanged()
  }

  async function remove(row: Row) {
    if (!(await ask({ title: `Hapus kendaraan "${row.vehicle.name}" dari trip ini?`, body: 'Bila sudah dipakai booking atau paket, kendaraan dinonaktifkan, bukan dihapus.' }))) return
    setListNotice(null)
    const j = await fetch(`/api/v1/admin/products/transport/pricing/${row.id}`, { method: 'DELETE' }).then(r => r.json()).catch(() => null)
    if (!j?.success) { setListNotice(j?.error ?? 'Gagal menghapus kendaraan.'); return }
    if (j.data?.message) setListNotice(j.data.message)
    await onChanged()
  }

  const used = new Set(pricing.map(p => p.vehicleId))
  const available = vehicles.filter(v => !used.has(v.id))
  const sellOf = (r: Row) => r.point?.sellIdr ?? null
  const columns: Column<Row>[] = [
    {
      key: 'vehicle', header: 'Kendaraan', mobile: 'title',
      cell: r => (
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-center gap-1.5 font-semibold capitalize text-admin-ink">
            {r.vehicle.name}
            {r.point?.mode === 'manual' && <Badge tone="warning">Manual</Badge>}
            {!r.isActive && <Badge tone="neutral">Nonaktif</Badge>}
          </p>
          <p className="m-0 mt-0.5 text-xs text-admin-muted">{r.vehicle.capacity} kursi · {r.costInfo?.vendorName || 'Vendor belum diisi'}</p>
        </div>
      ),
    },
    {
      key: 'cost', header: 'Biaya → HPP', align: 'right', hideBelowLg: true,
      cell: r => (
        <div className="text-right">
          <p className="m-0 whitespace-nowrap text-xs tabular-nums text-admin-ink">{r.costInfo?.cost != null ? money(r.costInfo.currency, r.costInfo.cost) : '—'}</p>
          {r.costInfo && r.costInfo.currency !== 'IDR' && <p className="m-0 whitespace-nowrap text-[11px] tabular-nums text-admin-muted">{rp(r.point?.costIdr)}</p>}
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
          <KindButton kind="view" label={`Lihat ${r.vehicle.name}`} onClick={() => setDialog({ kind: 'view', row: r })} />
          {canEditCost && <KindButton kind="edit" label={`Edit ${r.vehicle.name}`} onClick={() => openForm(r)} />}
          <KindButton kind={r.isActive ? 'deactivate' : 'activate'} label={`${r.isActive ? 'Nonaktifkan' : 'Aktifkan'} ${r.vehicle.name}`} onClick={() => { void setActive(r, !r.isActive) }} />
          <KindButton kind="delete" label={`Hapus ${r.vehicle.name}`} onClick={() => { void remove(r) }} />
        </RowActions>
      ),
    },
  ]

  const view = dialog?.kind === 'view' ? dialog.row : null
  const editing = dialog?.kind === 'form' ? dialog.row : null
  const canSubmit = (editing || !!vehicleId) && !!form.vendorId && costNum > 0

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
        <div className="min-w-0">
          <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><Car className="size-4 text-admin-accent" /> Harga per Kendaraan</h2>
          <p className="m-0 mt-1 text-xs text-admin-muted">Satu harga flat per kendaraan untuk rute ini: biaya vendor → HPP Rupiah → harga jual.</p>
        </div>
        {canEditCost && available.length > 0 && (
          <Button type="button" size="sm" className="shrink-0" onClick={() => openForm(null)} disabled={rows === null}><Plus className="size-3.5" /> Tambah kendaraan</Button>
        )}
      </div>
      {!canEditCost && <p role="status" className="m-0 text-xs text-admin-muted">Biaya vendor (HPP) hanya dapat diubah oleh superadmin.</p>}
      {listNotice && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{listNotice}</p>}

      <DataTable columns={columns} rows={rows ?? []} getRowId={r => r.id} loading={rows === null} empty="Belum ada kendaraan untuk trip ini." />

      <Modal open={formOpen} title={editing ? `Harga ${editing.vehicle.name}` : 'Tambah kendaraan'} onClose={() => setDialog(null)}>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save() }}>
          <CostFields
            value={form} onChange={v => { setError(null); setForm(v) }} preview={preview} marginPercent={marginPercent} currencies={CURRENCIES}
            vendorContext="transport" vendorLabel="Vendor transport" costLabel="Harga Kendaraan" unitHint="per kendaraan" idPrefix="tp"
            before={editing ? undefined : (
              <FormField label="Kendaraan" htmlFor="tp-vehicle" required>
                <ChoiceSelect ariaLabel="Kendaraan" placeholder="Pilih kendaraan…" value={vehicleId} onChange={setVehicleId} clearable={false}
                  options={available.map(v => ({ id: v.id, label: v.name, hint: `${v.capacity} org` }))} />
              </FormField>
            )}
          />
          {error && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-admin-line pt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => setDialog(null)}>Batal</Button>
            <Button type="submit" size="sm" loading={saving} disabled={!canSubmit}>{editing ? 'Simpan perubahan' : 'Tambahkan'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!view} title={view?.vehicle.name ?? ''} onClose={() => setDialog(null)}>
        {view && (
          <div className="space-y-4">
            <dl className="m-0 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {([
                ['Kapasitas', `${view.vehicle.capacity} kursi · ${view.vehicle.vehicleType}`],
                ['Vendor', view.costInfo?.vendorName || '—'],
                ['Biaya', view.costInfo?.cost != null ? money(view.costInfo.currency, view.costInfo.cost) : '—'],
                ['HPP (Rupiah)', rp(view.point?.costIdr)],
                ['Harga Jual Rekomendasi', rp(view.point?.autoSellIdr)],
                ['Harga jual berlaku', <span key="s" className="font-semibold text-admin-accent-strong">{rp(sellOf(view))} {view.point?.mode === 'manual' && <Badge tone="warning">Manual</Badge>}</span>],
                ['Untung', <ProfitText key="p" sell={sellOf(view)} cost={view.point?.costIdr ?? null} strong />],
                ['Status', view.isActive ? 'Aktif' : 'Nonaktif — tidak tampil di booking'],
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
              {canEditCost && <Button type="button" size="sm" onClick={() => openForm(view)}>Edit</Button>}
            </div>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </Card>
  )
}
