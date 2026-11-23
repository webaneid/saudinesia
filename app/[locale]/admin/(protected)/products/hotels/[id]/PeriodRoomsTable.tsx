'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { FormField } from '@/components/admin/ui/FormField'
import { Modal } from '@/components/admin/ui/Modal'
import { useIsSuperAdmin } from '@/components/admin/shell/AdminRole'
import { CostFields, ProfitText, emptyCost, manualSellOf, syncManualSell, useCostPreview, type CostValue } from '@/components/admin/pricing/CostFields'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { KindButton, RowActions } from '@/components/shared/data-table/RowActions'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { formatRupiah } from '@/lib/utils'
import type { RoomType } from './PeriodForm'

// Kamar satu periode harga sebagai TABEL + popup (docs/arsitektur-komponen-biaya.md §10, sama dengan Komponen Biaya). Vendor dan mata uang SATU per
// periode (docs/arsitektur-hotel.md §11.1): di popup hanya ditampilkan, kecuali periode belum punya kamar sama sekali (kamar pertama menentukannya).
// Menyimpan satu kamar = PUT periode dengan `prices.rooms` berisi kamar itu saja (lib/hotels/periods.ts membiarkan kamar lain), lalu harga jual
// manual lewat route titik harga (`syncManualSell`, ownerType `hotel` = jadwal kamar).

type Schedule = { id: string; roomTypeId: string; roomType: RoomType; totalQuota: number; pendingQuota: number; bookedQuota: number; isActive: boolean }
type PointInfo = { costIdr: number | null; sellIdr: number; autoSellIdr: number | null; mode: 'auto' | 'manual'; manualNote: string | null }
type Row = Schedule & { cost: number | null; point: PointInfo | null }
type PeriodCost = { vendorId: string | null; vendorName: string | null; currency: string | null }
type Dialog = { kind: 'form'; row: Row | null } | { kind: 'view'; row: Row }

const CURRENCIES = ['USD', 'SAR', 'EUR', 'IDR'] as const
const rp = (n: number | null | undefined) => (n == null ? '—' : formatRupiah(Math.round(n)))
const money = (currency: string, n: number) => (currency === 'IDR' ? formatRupiah(n) : `${currency} ${n.toLocaleString('id-ID')}`)

export function PeriodRoomsTable({ hotelId, periodId, schedules, roomTypes, ask, onChanged }: {
  hotelId: string; periodId: string; schedules: Schedule[]; roomTypes: RoomType[]
  ask: (o: { title: string; body?: string }) => Promise<boolean>
  onChanged: () => void | Promise<void>
}) {
  const canPrice = useIsSuperAdmin()
  const base = `/api/v1/admin/products/hotels/${hotelId}/periods/${periodId}`
  const [rows, setRows] = useState<Row[] | null>(null)
  const [period, setPeriod] = useState<PeriodCost>({ vendorId: null, vendorName: null, currency: null })
  const [marginPercent, setMarginPercent] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [roomTypeId, setRoomTypeId] = useState('')
  const [quota, setQuota] = useState('10')
  const [form, setForm] = useState<CostValue>(emptyCost('USD'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const active = schedules.filter(s => s.isActive)
  const load = useCallback(async () => {
    const costs = new Map<string, number | null>()
    if (canPrice) {
      const j = await fetch(`${base}/prices`).then(r => r.json()).catch(() => null)
      const d = j?.data as (PeriodCost & { rooms: { scheduleId: string; cost: number | null }[] }) | undefined
      if (d) {
        setPeriod({ vendorId: d.vendorId, vendorName: d.vendorName, currency: d.currency })
        for (const r of d.rooms) costs.set(r.scheduleId, r.cost)
      }
    }
    const loaded = await Promise.all(active.map(async s => {
      const j = await fetch(`/api/v1/admin/pricing/points?${new URLSearchParams({ ownerType: 'hotel', ownerId: s.id })}`).then(r => r.json()).catch(() => null)
      if (j?.data?.rule?.marginPercent != null) setMarginPercent(Number(j.data.rule.marginPercent))
      const point = (j?.data?.points as Array<PointInfo & { variantKey: string }> | undefined)?.find(p => p.variantKey === '') ?? null
      return { ...s, cost: costs.get(s.id) ?? null, point }
    }))
    setRows(loaded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, canPrice, schedules])

  useEffect(() => { void load() }, [load])

  const formOpen = dialog?.kind === 'form'
  const costNum = Number(form.cost)
  const preview = useCostPreview(formOpen && costNum > 0 ? `/api/v1/admin/products/hotels/simulate?${new URLSearchParams({ hargaKamar: String(costNum), currency: form.currency })}` : null)
  // Vendor & mata uang periode sudah ditetapkan kamar lain → dikunci di popup.
  const locked = !!period.vendorId && (rows?.length ?? 0) > (dialog?.kind === 'form' && dialog.row ? 1 : 0)

  function openForm(row: Row | null) {
    const manual = row?.point?.mode === 'manual'
    setRoomTypeId('')
    setQuota(row ? String(row.totalQuota) : '10')
    setForm({
      vendorId: period.vendorId ?? '', currency: period.currency ?? 'USD', cost: row?.cost ? String(row.cost) : '',
      sell: manual ? String(row!.point!.sellIdr) : '', sellEdited: manual, note: manual ? row!.point!.manualNote ?? '' : '',
    })
    setError(null)
    setDialog({ kind: 'form', row })
  }

  async function save() {
    if (dialog?.kind !== 'form') return
    const editing = dialog.row
    setSaving(true); setError(null)
    const r = await fetch(base, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prices: { vendorId: form.vendorId, currency: form.currency, rooms: [{ roomTypeId: editing?.roomTypeId ?? roomTypeId, cost: costNum, totalQuota: Number(quota || 0) }] } }),
    }).catch(() => null)
    if (!r?.ok) {
      const j: { error?: string } | null = await r?.json().catch(() => null) ?? null
      setError(j?.error ?? 'Harga kamar gagal disimpan.'); setSaving(false); return
    }
    // Jadwal kamar baru: id dibaca ulang dari isi periode (PUT periode tidak mengembalikannya).
    let scheduleId = editing?.id ?? null
    if (!scheduleId) {
      const j = await fetch(`${base}/prices`).then(x => x.json()).catch(() => null)
      scheduleId = (j?.data?.rooms as { roomTypeId: string; scheduleId: string }[] | undefined)?.find(x => x.roomTypeId === roomTypeId)?.scheduleId ?? null
    }
    const failed = scheduleId ? await syncManualSell({ ownerType: 'hotel', ownerId: scheduleId, manual: manualSellOf(form, preview), wasManual: editing?.point?.mode === 'manual', note: form.note }) : null
    await onChanged()
    setSaving(false)
    if (failed) { setError(`Kamar tersimpan, tetapi harga jual gagal disimpan: ${failed}`); return }
    setDialog(null)
  }

  async function remove(row: Row) {
    if (!(await ask({ title: `Hapus tipe kamar ${row.roomType.name} dari periode ini?`, body: 'Bila kamar ini sudah dipakai booking atau paket, kamar dinonaktifkan, bukan dihapus.' }))) return
    setNotice(null)
    const r = await fetch(`${base}/rooms/${row.id}`, { method: 'DELETE' }).catch(() => null)
    const j = await r?.json().catch(() => null)
    if (!r?.ok) { setNotice(j?.error ?? 'Gagal menghapus.'); return }
    if (!j?.data?.deleted) setNotice(j?.data?.message ?? 'Dinonaktifkan.')
    await onChanged()
  }

  const used = new Set(active.map(s => s.roomTypeId))
  const available = roomTypes.filter(rt => !used.has(rt.id))
  const sellOf = (r: Row) => r.point?.sellIdr ?? null
  const currency = period.currency ?? 'USD'
  const columns: Column<Row>[] = [
    {
      key: 'room', header: 'Tipe Kamar', mobile: 'title',
      cell: r => (
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-center gap-1.5 font-semibold text-admin-ink">{r.roomType.name} {r.point?.mode === 'manual' && <Badge tone="warning">Manual</Badge>}</p>
          <p className="m-0 mt-0.5 text-xs text-admin-muted">Kuota {r.totalQuota} · terpakai {r.pendingQuota + r.bookedQuota}</p>
        </div>
      ),
    },
    {
      key: 'cost', header: 'Biaya → HPP', align: 'right', hideBelowLg: true,
      cell: r => (
        <div className="text-right">
          <p className="m-0 whitespace-nowrap text-xs tabular-nums text-admin-ink">{r.cost != null ? money(currency, r.cost) : '—'}</p>
          {currency !== 'IDR' && <p className="m-0 whitespace-nowrap text-[11px] tabular-nums text-admin-muted">{rp(r.point?.costIdr)}</p>}
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
          <KindButton kind="view" label={`Lihat ${r.roomType.name}`} onClick={() => setDialog({ kind: 'view', row: r })} />
          {canPrice && <KindButton kind="edit" label={`Edit ${r.roomType.name}`} onClick={() => openForm(r)} />}
          {canPrice && <KindButton kind="delete" label={`Hapus ${r.roomType.name} dari periode`} onClick={() => { void remove(r) }} />}
        </RowActions>
      ),
    },
  ]

  const view = dialog?.kind === 'view' ? dialog.row : null
  const editing = dialog?.kind === 'form' ? dialog.row : null
  const canSubmit = (editing || !!roomTypeId) && !!form.vendorId && costNum > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-xs text-admin-muted">
          {period.vendorName ? <>Vendor periode: <b className="text-admin-ink">{period.vendorName}</b> · {currency}</> : 'Vendor dan mata uang ditetapkan saat kamar pertama diisi.'}
        </p>
        {canPrice && available.length > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={() => openForm(null)} disabled={rows === null}><Plus className="size-3.5" /> Tambah tipe kamar</Button>
        )}
      </div>
      {!canPrice && <p role="status" className="m-0 text-xs text-admin-muted">Harga modal dan kuota kamar diatur superadmin.</p>}
      {notice && <p role="status" className="m-0 text-xs font-medium text-admin-muted">{notice}</p>}

      <DataTable columns={columns} rows={rows ?? []} getRowId={r => r.id} loading={rows === null} empty="Belum ada harga kamar di periode ini." />

      <Modal open={formOpen} title={editing ? `Harga kamar ${editing.roomType.name}` : 'Tambah tipe kamar'} onClose={() => setDialog(null)}>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save() }}>
          <CostFields
            value={form} onChange={v => { setError(null); setForm(v) }} preview={preview} marginPercent={marginPercent} currencies={CURRENCIES}
            vendorContext="hotel" vendorLabel="Vendor hotel" costLabel="Harga Kamar" unitHint="per kamar per malam" idPrefix={`hr-${periodId}`}
            currencyLocked={locked}
            {...(locked ? { vendorSlot: (
              <div>
                <div className="admin-input flex items-center bg-admin-spot/50 text-admin-ink/80">{period.vendorName}</div>
                <p className="m-0 mt-1 text-xs text-admin-muted">Satu vendor dan mata uang untuk semua kamar di periode ini — ubah lewat Edit periode.</p>
              </div>
            ) } : {})}
            before={(
              <div className="grid gap-4 sm:grid-cols-2">
                {editing ? (
                  <FormField label="Tipe kamar" htmlFor="hr-type"><div className="admin-input flex items-center bg-admin-spot/50 font-semibold text-admin-ink">{editing.roomType.name}</div></FormField>
                ) : (
                  <FormField label="Tipe kamar" htmlFor="hr-type" required>
                    <ChoiceSelect ariaLabel="Tipe kamar" placeholder="Pilih tipe kamar…" value={roomTypeId} onChange={setRoomTypeId} clearable={false}
                      options={available.map(rt => ({ id: rt.id, label: rt.name, hint: `${rt.defaultCapacity} org` }))} />
                  </FormField>
                )}
                <FormField label="Kuota kamar" htmlFor="hr-quota" hint={editing ? `Minimal ${editing.pendingQuota + editing.bookedQuota} (sudah dipesan).` : 'Jumlah kamar yang bisa dijual di periode ini.'}>
                  <input id="hr-quota" className="admin-input tabular-nums" inputMode="numeric" value={quota} onChange={e => setQuota(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                </FormField>
              </div>
            )}
          />
          {error && <p role="alert" className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-admin-line pt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => setDialog(null)}>Batal</Button>
            <Button type="submit" size="sm" loading={saving} disabled={!canSubmit}>{editing ? 'Simpan perubahan' : 'Tambahkan'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!view} title={view ? `Kamar ${view.roomType.name}` : ''} onClose={() => setDialog(null)}>
        {view && (
          <div className="space-y-4">
            <dl className="m-0 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {([
                ['Kuota', `${view.totalQuota} kamar · terpakai ${view.pendingQuota + view.bookedQuota}`],
                ['Vendor', period.vendorName ?? '—'],
                ['Biaya', view.cost != null ? money(currency, view.cost) : '—'],
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
              {canPrice && <Button type="button" size="sm" onClick={() => openForm(view)}>Edit</Button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
