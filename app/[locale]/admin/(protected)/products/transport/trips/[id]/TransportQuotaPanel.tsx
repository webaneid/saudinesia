'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, Check, X } from 'lucide-react'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { ActionButton, KindButton, RowActions } from '@/components/admin/data-table/RowActions'
import { useListPage } from '@/components/admin/data-table/useListPage'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import type { PageMeta } from '@/lib/table/pagination'
import { formatCalendarDate, todayInApp } from '@/lib/time'
import type { QuotaRow } from '@/lib/transport/quotas'
import { formatRupiah } from '@/lib/utils'

type PricingOption = { id: string; price: number; vehicle: { name: string; capacity: number } }
const API = '/api/v1/admin/products/transport/quotas'

/** Kuota per tanggal (docs/arsitektur-transportasi.md §10): tanpa baris di sini, trip tidak muncul sebagai pilihan di booking. */
export function TransportQuotaPanel({ tripId, pricing }: { tripId: string; pricing: PricingOption[] }) {
  const { page, limit, setPage, setParams, get, reset } = useListPage('quota')
  const filter = get('pricing')
  const [rows, setRows] = useState<QuotaRow[]>([])
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ pricingId: '', from: '', to: '', totalSeats: '' })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [editing, setEditing] = useState<{ id: string; seats: string } | null>(null)
  const { ask, dialog } = useConfirm()

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ tripId, page: String(page), limit: String(limit), ...(filter ? { pricingId: filter } : {}) })
    const j = await fetch(`${API}?${qs}`).then(r => r.json()).catch(() => null)
    if (j?.success) { setRows(j.data); setMeta(j.meta ?? null) } else setNotice({ tone: 'error', text: j?.error ?? 'Gagal memuat kuota' })
    setLoading(false)
  }, [tripId, page, limit, filter])
  useEffect(() => { void load() }, [load])

  function pickVehicle(id: string) {
    const p = pricing.find(x => x.id === id)
    setForm(f => ({ ...f, pricingId: id, totalSeats: p ? String(p.vehicle.capacity) : f.totalSeats }))
  }

  async function send(url: string, method: string, body?: unknown): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const r = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }).catch(() => null)
    return r ? r.json().catch(() => ({ success: false, error: 'Respons server tidak terbaca' })) : { success: false, error: 'Tidak bisa menghubungi server' }
  }

  async function open() {
    setSaving(true); setNotice(null)
    const j = await send(API, 'POST', { pricingId: form.pricingId, from: form.from, to: form.to || form.from, totalSeats: Number(form.totalSeats) })
    setSaving(false)
    if (!j.success) { setNotice({ tone: 'error', text: j.error ?? 'Gagal membuka tanggal' }); return }
    const { created, skipped } = j.data as { created: number; skipped: number }
    setNotice({ tone: 'ok', text: `${created} tanggal dibuka${skipped ? `, ${skipped} tanggal sudah ada dan tidak diubah` : ''}.` })
    setForm(f => ({ ...f, from: '', to: '' }))
    void load()
  }

  async function saveSeats() {
    if (!editing) return
    setNotice(null)
    const j = await send(`${API}/${editing.id}`, 'PUT', { totalSeats: Number(editing.seats) })
    if (!j.success) { setNotice({ tone: 'error', text: j.error ?? 'Gagal menyimpan' }); return }
    setEditing(null); void load()
  }

  async function remove(q: QuotaRow) {
    if (!(await ask({ title: `Hapus kuota ${formatCalendarDate(q.travelDate)} (${q.vehicle})?` }))) return
    setNotice(null)
    const j = await send(`${API}/${q.id}`, 'DELETE')
    if (!j.success) { setNotice({ tone: 'error', text: j.error ?? 'Gagal menghapus' }); return }
    void load()
  }

  const columns: Column<QuotaRow>[] = [
    { key: 'date', header: 'Tanggal', mobile: 'title', cell: q => <span className="text-[13px] font-medium whitespace-nowrap">{formatCalendarDate(q.travelDate)}</span> },
    { key: 'vehicle', header: 'Kendaraan', cell: q => <span className="text-[12px] text-admin-muted">{q.vehicle}</span> },
    {
      key: 'total', header: 'Kursi', align: 'right',
      cell: q => editing?.id === q.id
        ? <input type="number" min={1} aria-label="Jumlah kursi" className="admin-inp w-16 px-2 text-right" value={editing.seats} onChange={e => setEditing({ id: q.id, seats: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') void saveSeats() }} />
        : <span className="tabular-nums">{q.totalSeats}</span>,
    },
    { key: 'pending', header: 'Pending', align: 'right', cell: q => <span className="tabular-nums text-admin-gold-strong">{q.pendingSeats}</span> },
    { key: 'booked', header: 'Booked', align: 'right', cell: q => <span className="tabular-nums text-admin-accent-strong">{q.bookedSeats}</span> },
    { key: 'left', header: 'Sisa', align: 'right', cell: q => <span className="font-bold tabular-nums">{q.seatsLeft}</span> },
    {
      key: 'actions', header: '', actions: true,
      cell: q => editing?.id === q.id
        ? <RowActions>
            <ActionButton icon={Check} label={`Simpan kursi ${formatCalendarDate(q.travelDate)}`} onClick={() => void saveSeats()} />
            <ActionButton icon={X} label="Batal ubah kursi" onClick={() => setEditing(null)} />
          </RowActions>
        : <RowActions>
            <KindButton kind="edit" label={`Ubah kursi ${formatCalendarDate(q.travelDate)}`} onClick={() => setEditing({ id: q.id, seats: String(q.totalSeats) })} />
            {!q.used && <KindButton kind="delete" label={`Hapus ${formatCalendarDate(q.travelDate)}`} onClick={() => void remove(q)} />}
          </RowActions>,
    },
  ]

  const unpriced = pricing.find(p => p.id === form.pricingId && !(p.price > 0))
  const canOpen = form.pricingId && form.from && Number(form.totalSeats) >= 1 && !saving

  return (
    <div className="admin-form-panel space-y-4">
      {dialog}
      <div>
        <p className="text-sm font-semibold text-admin-ink flex items-center gap-1.5"><CalendarPlus className="h-4 w-4" /> Kuota Tanggal</p>
        <p className="text-[11px] text-admin-muted/70 mt-0.5">Tanggal yang dibuka di sini menjadi pilihan transport saat booking. Tanggal akhir kosong = satu hari.</p>
      </div>

      {pricing.length === 0
        ? <p className="text-[13px] text-admin-muted/70 py-4 text-center border border-dashed border-admin-line rounded-xl">Tambahkan kendaraan dulu di atas.</p>
        : (
          <div className="grid gap-3 md:grid-cols-3 md:items-end">
            <div className="md:col-span-3">
              <p className="text-xs text-admin-muted mb-1">Kendaraan</p>
              <ChoiceSelect placeholder="— pilih kendaraan —" value={form.pricingId} onChange={pickVehicle}
                options={pricing.map(p => ({ id: p.id, label: p.vehicle.name, hint: p.price > 0 ? formatRupiah(p.price) : 'belum berharga' }))} />
            </div>
            <label className="block"><span className="block text-xs text-admin-muted mb-1">Dari tanggal</span>
              <input type="date" className="admin-inp" min={todayInApp()} value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} /></label>
            <label className="block"><span className="block text-xs text-admin-muted mb-1">Sampai tanggal</span>
              <input type="date" className="admin-inp" min={form.from || todayInApp()} value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} /></label>
            <label className="block"><span className="block text-xs text-admin-muted mb-1">Kursi per tanggal</span>
              <input type="number" min={1} className="admin-inp" value={form.totalSeats} onChange={e => setForm(f => ({ ...f, totalSeats: e.target.value }))} /></label>
            <div className="md:col-span-3">
              <button type="button" onClick={open} disabled={!canOpen} className="admin-btn-sm disabled:opacity-50">{saving ? 'Membuka...' : 'Buka Tanggal'}</button>
            </div>
          </div>
        )}

      {unpriced && <p className="text-[12px] text-admin-gold-strong">Kendaraan ini belum berharga. Tanggalnya tetap bisa dibuka, tetapi booking ditolak sampai harganya diisi.</p>}
      {notice && <p role="status" className={`text-[12px] ${notice.tone === 'ok' ? 'text-admin-ok' : 'text-admin-danger'}`}>{notice.text}</p>}

      <FilterBar active={!!filter} onReset={() => reset(['pricing'])}>
        <FilterSelect label="Kendaraan" allLabel="Semua kendaraan" value={filter} onChange={v => setParams({ pricing: v || undefined })}
          options={pricing.map(p => ({ value: p.id, label: p.vehicle.name }))} />
      </FilterBar>
      <DataTable columns={columns} rows={rows} getRowId={q => q.id} loading={loading} empty="Belum ada tanggal yang dibuka."
        footer={meta && meta.total > 0 ? <Pagination {...meta} onPageChange={setPage} /> : undefined} />
    </div>
  )
}
