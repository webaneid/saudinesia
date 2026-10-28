'use client'

import { useCallback, useEffect, useState } from 'react'
import { Wallet, Undo2 } from 'lucide-react'
import { ActionButton, RowActions } from '@/components/admin/data-table/RowActions'
import { formatRupiah } from '@/lib/utils'
import { VendorPicker } from '@/components/admin/vendor/VendorPicker'

// Pengeluaran aktual ke vendor vs modal rencana (docs/arsitektur-harga-terpadu.md §20, 7C). Catatan penyebab selisih wajib bila lunas ≠ rencana atau sudah melebihi rencana
// (server yang memutuskan; pesan galatnya ditampilkan apa adanya). "Hapus" = BATALKAN dengan alasan (riwayat tetap).

type Entry = {
  id: string; vendorId: string; vendorName: string; component: string; currency: string; amount: number; amountIdr: number; paidAt: string; isSettled: boolean
  varianceNote: string | null; recordedByName: string | null; voided: boolean; voidReason: string | null
}
type Line = { snapshotId: string; itemType: string; label: string; planIdr: number | null; plannedVendorIds: string[]; actualIdr: number; varianceIdr: number | null; settled: boolean; needsNote: boolean; entries: Entry[] }
type Data = { lines: Line[]; loose: Entry[] }

const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)

export function CostActualsPanel({ bookingId }: { bookingId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [snapshotId, setSnapshotId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [component, setComponent] = useState('')
  const [currency, setCurrency] = useState('IDR')
  const [amount, setAmount] = useState('')
  const [amountIdr, setAmountIdr] = useState('')
  const [paidAt, setPaidAt] = useState(today())
  const [settled, setSettled] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/cost-actuals`)
    const j = await res.json().catch(() => null)
    if (res.ok && j?.data) setData(j.data)
    else setError(j?.error ?? 'Data pengeluaran gagal dimuat')
  }, [bookingId])
  useEffect(() => { void load() }, [load])

  function pick(id: string) {
    setSnapshotId(id)
    const line = data?.lines.find(l => l.snapshotId === id)
    if (line) { setComponent(line.label); if (!vendorId && line.plannedVendorIds[0]) setVendorId(line.plannedVendorIds[0]) }
  }

  async function submit() {
    setBusy(true); setError('')
    const body = {
      ...(snapshotId ? { snapshotId } : {}), vendorId, component, currency: currency.toUpperCase(), amount: Number(amount),
      ...(currency.toUpperCase() !== 'IDR' && amountIdr ? { amountIdr: Number(amountIdr) } : {}), paidAt, isSettled: settled, ...(note.trim() ? { varianceNote: note } : {}),
    }
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/cost-actuals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(j?.error ?? 'Gagal menyimpan pengeluaran'); return }
    setAmount(''); setAmountIdr(''); setNote(''); setSettled(false)
    await load()
  }

  async function voidEntry(id: string) {
    const reason = window.prompt('Alasan membatalkan catatan pengeluaran ini?')
    if (!reason || reason.trim().length < 3) return
    setBusy(true); setError('')
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/cost-actuals/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
    const j = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(j?.error ?? 'Gagal membatalkan'); return }
    await load()
  }

  const rp = (n: number | null) => (n == null ? '—' : formatRupiah(n))
  const entryRow = (e: Entry) => (
    <li key={e.id} className={`flex flex-wrap items-start justify-between gap-2 py-1.5 text-[12px] ${e.voided ? 'opacity-50' : ''}`}>
      <div className="min-w-0">
        <p className="m-0 font-medium text-admin-ink">{e.vendorName} · {e.component}{e.isSettled && <span className="ml-1.5 rounded bg-admin-ok/10 px-1.5 py-0.5 text-[10px] font-bold text-admin-ok">lunas</span>}{e.voided && <span className="ml-1.5 text-admin-muted">(dibatalkan: {e.voidReason})</span>}</p>
        <p className="m-0 text-admin-muted">{e.paidAt}{e.currency !== 'IDR' ? ` · ${e.amount.toLocaleString('id-ID')} ${e.currency}` : ''} · {e.recordedByName ?? 'staf'}{e.varianceNote ? ` · Catatan: ${e.varianceNote}` : ''}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-semibold tabular-nums">{formatRupiah(e.amountIdr)}</span>
        {!e.voided && <RowActions><ActionButton icon={Undo2} label={`Batalkan pengeluaran ${e.component}`} disabled={busy} onClick={() => voidEntry(e.id)} /></RowActions>}
      </div>
    </li>
  )

  return (
    <div className="admin-card p-4 space-y-3">
      <p className="admin-section flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Pengeluaran Vendor (Aktual vs HPP)</p>
      {error && <p role="alert" className="m-0 text-[12px] font-medium text-admin-danger">{error}</p>}

      {data && data.lines.length > 0 && (
        <div className="space-y-2">
          {data.lines.map(l => (
            <div key={l.snapshotId} className="rounded-xl border border-admin-line p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <span className="font-semibold text-admin-ink">{l.label}</span>
                <span className="tabular-nums text-admin-muted">
                  Rencana {rp(l.planIdr)} · Keluar {rp(l.actualIdr)}
                  {l.varianceIdr != null && <span className={`ml-1.5 font-bold ${l.varianceIdr > 0 ? 'text-admin-danger' : l.varianceIdr < 0 ? 'text-admin-ok' : ''}`}>({l.varianceIdr > 0 ? '+' : ''}{formatRupiah(l.varianceIdr)})</span>}
                  {l.settled && <span className="ml-1.5 text-admin-ok">lunas</span>}
                  {l.needsNote && <span className="ml-1.5 font-bold text-admin-danger">perlu catatan</span>}
                </span>
              </div>
              {l.entries.length > 0 && <ul className="m-0 mt-1 list-none divide-y divide-admin-line p-0">{l.entries.map(entryRow)}</ul>}
            </div>
          ))}
        </div>
      )}
      {data && data.loose.length > 0 && (
        <div className="rounded-xl border border-admin-line p-2.5">
          <p className="m-0 text-[12px] font-semibold text-admin-ink">Tanpa rujukan baris rencana</p>
          <ul className="m-0 list-none divide-y divide-admin-line p-0">{data.loose.map(entryRow)}</ul>
        </div>
      )}

      <div className="space-y-2 border-t border-admin-line pt-3">
        <p className="m-0 text-[12px] font-semibold text-admin-ink">Catat pengeluaran</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select aria-label="Baris rencana" className="admin-select" value={snapshotId} onChange={e => pick(e.target.value)}>
            <option value="">Tanpa rujukan baris rencana</option>
            {data?.lines.map(l => <option key={l.snapshotId} value={l.snapshotId}>{l.label} (rencana {rp(l.planIdr)})</option>)}
          </select>
          <input aria-label="Komponen" className="admin-inp" maxLength={120} placeholder="Untuk apa (komponen)" value={component} onChange={e => setComponent(e.target.value)} />
        </div>
        <VendorPicker value={vendorId} onChange={setVendorId} context="costComponent" label="Vendor yang dibayar" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input aria-label="Mata uang" className="admin-inp uppercase" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value)} />
          <input aria-label="Jumlah" type="number" min={0} className="admin-inp" placeholder="Jumlah" value={amount} onChange={e => setAmount(e.target.value)} />
          {currency.toUpperCase() !== 'IDR' && <input aria-label="Rupiah yang keluar" type="number" min={0} className="admin-inp" placeholder="Rupiah yang keluar" value={amountIdr} onChange={e => setAmountIdr(e.target.value)} />}
          <input aria-label="Tanggal bayar" type="date" className="admin-inp" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
        </div>
        <textarea aria-label="Catatan selisih" className="admin-inp w-full" rows={2} maxLength={500} placeholder="Catatan penyebab selisih (wajib bila lunas ≠ rencana atau melebihi rencana)" value={note} onChange={e => setNote(e.target.value)} />
        <label className="flex items-center gap-2 text-[12px] text-admin-muted"><input type="checkbox" checked={settled} onChange={e => setSettled(e.target.checked)} /> Ini pembayaran terakhir untuk baris ini (lunas)</label>
        <button type="button" disabled={busy || !vendorId || !component.trim() || !Number(amount)} onClick={submit} className="admin-btn-sm">Simpan pengeluaran</button>
      </div>
    </div>
  )
}
