'use client'

import { useEffect, useState } from 'react'
import { Save, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { VendorPicker } from '@/components/admin/vendor/VendorPicker'
import { CurrencySelect } from '@/components/shared/CurrencySelect'
import { KindButton } from '@/components/shared/data-table/RowActions'
import { useIsSuperAdmin } from '@/components/admin/shell/AdminRole'
import { DATE_SHORT_MONTH, addDays, daysBetween, formatCalendarDate, type CalendarDate } from '@/lib/time'

const CURRENCIES = ['USD', 'SAR', 'EUR', 'IDR']

export type RoomType = { id: string; name: string; defaultCapacity: number }
export type FormSource = { id: string; periodStart: string; periodEnd: string }
type RoomInput = { cost: string; totalQuota: string; scheduleId: string | null; preview: { hppRupiah: number; sellPrice: number } | null }
type Ask = (o: { title: string; body?: string }) => Promise<boolean>

const day = (iso: string) => iso.slice(0, 10)
const formatDate = (d: string) => formatCalendarDate(day(d) as CalendarDate, DATE_SHORT_MONTH)

/** Tanggal bawaan duplikat: mulai sehari setelah periode sumber berakhir, panjang sama (admin bisa ubah). */
function nextRange(start: string, end: string): { periodStart: string; periodEnd: string } {
  const from = addDays(day(end) as CalendarDate, 1)
  return { periodStart: from, periodEnd: addDays(from, daysBetween(day(start) as CalendarDate, day(end) as CalendarDate)) }
}

/**
 * SATU formulir periode harga hotel untuk Tambah, Edit, dan Duplikat (docs/arsitektur-hotel.md §12.4): tanggal + vendor & mata uang + harga modal dan kuota
 * tiap tipe kamar, disimpan bersama dalam satu permintaan (server: satu transaksi di lib/hotels/periods.ts). Edit dan Duplikat diisi dari periode sumber;
 * Duplikat menggeser tanggal ke periode berikutnya. Isi kamar = HPP → hanya superadmin; manager hanya mengubah tanggal.
 */
export function PeriodForm({ mode, hotelId, roomTypes, source, ask, onDone, onCancel }: {
  mode: 'create' | 'edit' | 'duplicate'; hotelId: string; roomTypes: RoomType[]; source?: FormSource
  ask: Ask; onDone: (periodId: string) => void | Promise<void>; onCancel: () => void
}) {
  const canPrice = useIsSuperAdmin()
  const base = `/api/v1/admin/products/hotels/${hotelId}/periods`
  const [dates, setDates] = useState(() => !source ? { periodStart: '', periodEnd: '' }
    : mode === 'duplicate' ? nextRange(source.periodStart, source.periodEnd)
    : { periodStart: day(source.periodStart), periodEnd: day(source.periodEnd) })
  const [vendorId, setVendorId] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [rooms, setRooms] = useState<Record<string, RoomInput>>({})
  const [loading, setLoading] = useState(!!source && canPrice)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function loadContents() {
    if (!source || !canPrice) return
    const r = await fetch(`${base}/${source.id}/prices`)
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.data) { setError(j?.error ?? 'Isi periode gagal dimuat.'); setLoading(false); return }
    setVendorId(j.data.vendorId ?? '')
    setCurrency(j.data.currency ?? 'USD')
    const next: Record<string, RoomInput> = {}
    for (const row of j.data.rooms as { roomTypeId: string; scheduleId: string; cost: number | null; totalQuota: number }[]) {
      next[row.roomTypeId] = { cost: row.cost ? String(row.cost) : '', totalQuota: String(row.totalQuota), scheduleId: mode === 'edit' ? row.scheduleId : null, preview: null }
    }
    setRooms(next)
    setLoading(false)
  }
  useEffect(() => { void loadContents() }, [source?.id, mode])

  function updateRoom(roomTypeId: string, field: 'cost' | 'totalQuota', value: string) {
    setRooms(p => ({ ...p, [roomTypeId]: { cost: '', totalQuota: '10', scheduleId: null, preview: null, ...p[roomTypeId], [field]: value } }))
  }

  // Pratinjau HPP / harga jual per tipe kamar — debounce 500 ms ke endpoint simulate (§10).
  const costKey = JSON.stringify(Object.fromEntries(Object.entries(rooms).map(([k, v]) => [k, v.cost])))
  useEffect(() => {
    const timer = setTimeout(async () => {
      const entries = Object.entries(rooms).filter(([, v]) => Number(v.cost) > 0)
      if (entries.length === 0) return
      const results = await Promise.all(entries.map(async ([roomTypeId, v]) => {
        const r = await fetch(`/api/v1/admin/products/hotels/simulate?${new URLSearchParams({ hargaKamar: v.cost, currency })}`)
        const j = await r.json().catch(() => null)
        return [roomTypeId, j?.data ? { hppRupiah: j.data.hppRupiah, sellPrice: j.data.sellPrice } : null] as const
      }))
      setRooms(p => {
        const next = { ...p }
        for (const [id, preview] of results) if (next[id]) next[id] = { ...next[id], preview }
        return next
      })
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, costKey])

  async function removeRoom(roomTypeId: string, scheduleId: string, name: string) {
    if (!source || !(await ask({ title: `Hapus tipe kamar ${name} dari periode ini?`, body: 'Bila kamar ini sudah dipakai booking atau paket, kamar dinonaktifkan, bukan dihapus.' }))) return
    const r = await fetch(`${base}/${source.id}/rooms/${scheduleId}`, { method: 'DELETE' })
    const j = await r.json().catch(() => null)
    if (!r.ok) { setError(j?.error ?? 'Gagal menghapus.'); return }
    setNotice(j?.data?.deleted ? null : j?.data?.message ?? 'Dinonaktifkan.')
    setRooms(p => { const next = { ...p }; delete next[roomTypeId]; return next })
  }

  const filled = Object.entries(rooms).filter(([, v]) => Number(v.cost) > 0)
  const emptyExisting = roomTypes.find(rt => rooms[rt.id]?.scheduleId && !(Number(rooms[rt.id]?.cost) > 0))

  async function submit() {
    setError(null); setNotice(null)
    if (!dates.periodStart || !dates.periodEnd) { setError('Isi tanggal mulai dan akhir periode.'); return }
    if (canPrice && filled.length > 0 && !vendorId) { setError('Pilih vendor untuk harga kamar.'); return }
    if (emptyExisting) { setError(`Isi harga ${emptyExisting.name} atau hapus tipe kamar itu dari periode.`); return }
    const prices = canPrice && filled.length > 0
      ? { vendorId, currency, rooms: filled.map(([roomTypeId, v]) => ({ roomTypeId, cost: Number(v.cost), totalQuota: Number(v.totalQuota || 0) })) }
      : undefined
    const url = mode === 'create' ? base : mode === 'edit' ? `${base}/${source!.id}` : `${base}/${source!.id}/duplicate`
    setBusy(true)
    try {
      const r = await fetch(url, { method: mode === 'edit' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...dates, ...(prices ? { prices } : {}) }) })
      const j = await r.json().catch(() => null)
      if (!r.ok) { setError(j?.error ?? 'Periode gagal disimpan.'); return }
      await onDone(mode === 'edit' ? source!.id : (j?.data as { id: string }).id)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setBusy(false)
    }
  }

  const heading = mode === 'create' ? 'Periode baru'
    : mode === 'edit' ? `Ubah periode ${formatDate(source!.periodStart)} – ${formatDate(source!.periodEnd)}`
    : `Duplikat periode ${formatDate(source!.periodStart)} – ${formatDate(source!.periodEnd)}`

  return (
    <div className="space-y-3 border-t border-admin-line bg-admin-spot/30 p-4 first:border-t-0">
      <div>
        <p className="m-0 text-xs font-semibold text-admin-ink">{heading}</p>
        {mode === 'duplicate' && <p className="m-0 mt-0.5 text-[11px] text-admin-muted">Semua isi periode sumber sudah tersalin — ubah tanggal dan harga bila perlu, lalu simpan sebagai periode baru. Harga jual manual ikut disalin.</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1"><span className="block text-[11px] text-admin-muted">Mulai</span>
          <input type="date" className="admin-inp" aria-label="Tanggal mulai periode" value={dates.periodStart} onChange={e => setDates(d => ({ ...d, periodStart: e.target.value }))} /></label>
        <label className="space-y-1"><span className="block text-[11px] text-admin-muted">Akhir</span>
          <input type="date" className="admin-inp" aria-label="Tanggal akhir periode" min={dates.periodStart} value={dates.periodEnd} onChange={e => setDates(d => ({ ...d, periodEnd: e.target.value }))} /></label>
      </div>

      {!canPrice ? (
        <p className="m-0 text-[11px] text-admin-muted">Harga modal dan kuota kamar diatur superadmin; di sini Anda mengubah tanggal periode.</p>
      ) : loading ? (
        <p className="m-0 text-[12px] text-admin-muted">Memuat isi periode…</p>
      ) : (
        <>
          <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-admin-ink"><Wallet className="h-3.5 w-3.5" /> Vendor &amp; Mata Uang (berlaku untuk semua tipe kamar di periode ini)</p>
          <VendorPicker value={vendorId} onChange={setVendorId} context="hotel" label="Vendor hotel" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-admin-muted">Mata uang</span>
            <CurrencySelect value={currency} onChange={setCurrency} currencies={CURRENCIES} />
          </div>
          <div className="-mx-1 overflow-x-auto px-1">{/* HP: grid harga digeser ke samping, bukan terpotong */}
            <div className="min-w-max space-y-2">
              <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-admin-muted/70">
                <span className="w-24">Tipe Kamar</span><span className="w-24">Modal ({currency})</span><span className="w-20">Kuota</span><span className="w-28">HPP</span><span className="w-32">Harga Jual</span>
              </div>
              {roomTypes.map(rt => {
                const v = rooms[rt.id] ?? { cost: '', totalQuota: '10', scheduleId: null, preview: null }
                return (
                  <div key={rt.id} className="flex items-center gap-2">
                    <span className="w-24 truncate text-[12.5px] text-admin-ink/80">{rt.name}</span>
                    <input type="number" className="admin-inp w-24" placeholder="0" aria-label={`Modal ${rt.name}`} value={v.cost} onChange={e => updateRoom(rt.id, 'cost', e.target.value)} />
                    <input type="number" className="admin-inp w-20" placeholder="Kuota" aria-label={`Kuota ${rt.name}`} value={v.totalQuota} onChange={e => updateRoom(rt.id, 'totalQuota', e.target.value)} />
                    <span className="w-28 truncate text-[12.5px] font-semibold text-admin-ink">{v.preview && Number(v.cost) > 0 ? formatRupiah(Math.round(v.preview.hppRupiah)) : '—'}</span>
                    <span className="w-32 truncate text-[12.5px] font-semibold text-admin-ink">{v.preview && Number(v.cost) > 0 ? formatRupiah(v.preview.sellPrice) : '—'}</span>
                    {v.scheduleId && <KindButton kind="delete" label={`Hapus tipe kamar ${rt.name} dari periode`} onClick={() => removeRoom(rt.id, v.scheduleId!, rt.name)} disabled={busy} />}
                  </div>
                )
              })}
            </div>
          </div>
          <p className="m-0 text-[11px] text-admin-muted/70">Tipe kamar yang modalnya kosong tidak dijual di periode ini.</p>
        </>
      )}

      {error && <p role="alert" className="m-0 text-[12px] font-medium text-admin-danger">{error}</p>}
      {notice && <p role="status" className="m-0 text-[12px] font-medium text-admin-muted">{notice}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy || loading} className="admin-btn-sm flex items-center gap-1.5 disabled:opacity-50">
          <Save className="h-3.5 w-3.5" /> {busy ? 'Menyimpan...' : mode === 'duplicate' ? 'Simpan sebagai periode baru' : 'Simpan periode'}
        </button>
        <button type="button" onClick={onCancel} className="admin-btn-ghost text-sm">Batal</button>
      </div>
    </div>
  )
}
