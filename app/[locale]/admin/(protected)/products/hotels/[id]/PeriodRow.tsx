'use client'

import { useState } from 'react'
import { formatRupiah } from '@/lib/utils'
import { PriceCard } from '@/components/admin/pricing/PriceCard'
import { KindButton } from '@/components/shared/data-table/RowActions'
import { useIsSuperAdmin } from '@/components/admin/shell/AdminRole'
import { DATE_SHORT_MONTH, formatCalendarDate, type CalendarDate } from '@/lib/time'
import { PeriodForm, type RoomType } from './PeriodForm'

type Schedule = {
  id: string; roomTypeId: string; roomType: RoomType
  price: number; totalQuota: number; pendingQuota: number; bookedQuota: number; isActive: boolean
}
export type Period = { id: string; periodStart: string; periodEnd: string; isActive: boolean; schedules: Schedule[] }
type Ask = (o: { title: string; body?: string }) => Promise<boolean>

const formatDate = (d: string) => formatCalendarDate(d.slice(0, 10) as CalendarDate, DATE_SHORT_MONTH)

/** Satu periode harga: ringkasan (klik) · Edit / Duplikat = formulir periode lengkap (PeriodForm) · Hapus-aman / Aktifkan (docs/arsitektur-hotel.md §12.4). */
export function PeriodRow({ period, hotelId, roomTypes, expanded, onToggle, onSaved, ask, onDuplicated }: {
  period: Period; hotelId: string; roomTypes: RoomType[]
  expanded: boolean; onToggle: () => void; onSaved: () => Promise<void>
  ask: Ask; onDuplicated: (newId: string) => Promise<void>
}) {
  const isSuperAdmin = useIsSuperAdmin()
  const base = `/api/v1/admin/products/hotels/${hotelId}/periods/${period.id}`
  const [mode, setMode] = useState<'view' | 'edit' | 'duplicate'>('view')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [priceTick, setPriceTick] = useState(0)
  const open = (m: 'edit' | 'duplicate') => { setNotice(null); setMode(cur => cur === m ? 'view' : m) }

  async function call(method: 'PUT' | 'DELETE', body?: unknown) {
    setBusy(true); setNotice(null)
    try {
      const r = await fetch(base, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      const j = await r.json().catch(() => null)
      if (!r.ok) { setNotice({ tone: 'error', text: j?.error ?? 'Permintaan gagal.' }); return null }
      return { data: j?.data as unknown }
    } catch { setNotice({ tone: 'error', text: 'Tidak dapat menghubungi server.' }); return null } finally { setBusy(false) }
  }
  async function remove() {
    if (!(await ask({ title: `Hapus periode ${formatDate(period.periodStart)} – ${formatDate(period.periodEnd)}?`, body: 'Harga semua tipe kamar di periode ini ikut terhapus. Bila periode sudah dipakai booking atau paket, periode dinonaktifkan, bukan dihapus.' }))) return
    const r = await call('DELETE')
    if (!r) return
    const d = r.data as { deleted: boolean; message?: string }
    if (!d.deleted) setNotice({ tone: 'ok', text: d.message ?? 'Dinonaktifkan.' })
    await onSaved()
  }
  async function activate() { if (await call('PUT', { isActive: true })) await onSaved() }

  const active = period.schedules.filter(s => s.isActive)
  const prices = active.map(s => s.price)
  const range = prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null

  return (
    <div className="overflow-hidden rounded-xl border border-admin-line">
      <div className="flex items-center gap-2 pr-3">
        <button type="button" onClick={onToggle} aria-expanded={expanded} className={`flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-admin-spot/30 ${period.isActive ? '' : 'opacity-60'}`}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13px] font-semibold text-admin-ink">{formatDate(period.periodStart)} – {formatDate(period.periodEnd)}</span>
            <span className="text-[11px] text-admin-muted">{active.length} tipe kamar terisi</span>
            {!period.isActive && <span className="admin-badge-gray">Nonaktif</span>}
          </span>
          <span className="text-[13px] font-bold text-admin-ink">
            {range ? range.min === range.max ? formatRupiah(range.min) : `${formatRupiah(range.min)} – ${formatRupiah(range.max)}` : 'Belum ada harga'}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <KindButton kind="edit" label="Edit periode" onClick={() => open('edit')} disabled={busy} />
          {isSuperAdmin && <KindButton kind="duplicate" label="Duplikat periode" onClick={() => open('duplicate')} disabled={busy} />}
          {period.isActive
            ? <KindButton kind="delete" label="Hapus periode" onClick={remove} disabled={busy} />
            : <KindButton kind="activate" label="Aktifkan periode" onClick={activate} disabled={busy} />}
        </div>
      </div>

      {mode !== 'view' && (
        <PeriodForm
          key={mode} mode={mode} hotelId={hotelId} roomTypes={roomTypes} source={period} ask={ask}
          onCancel={() => setMode('view')}
          onDone={async id => { setMode('view'); setPriceTick(t => t + 1); if (mode === 'duplicate') await onDuplicated(id); else await onSaved() }}
        />
      )}
      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`m-0 border-t border-admin-line px-4 py-2 text-[12px] font-medium ${notice.tone === 'error' ? 'text-admin-danger' : 'text-admin-muted'}`}>{notice.text}</p>}

      {expanded && mode === 'view' && (
        <div className="space-y-3 border-t border-admin-line bg-admin-spot/20 p-4">
          {active.length === 0 ? (
            <p className="m-0 text-[12px] text-admin-muted">Belum ada harga kamar. Klik ikon pensil untuk mengisi.</p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <div className="min-w-max space-y-1.5">
                <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-admin-muted/70">
                  <span className="w-28">Tipe Kamar</span><span className="w-32">Kuota (terpakai)</span><span className="w-32">Harga Jual</span>
                </div>
                {active.map(s => (
                  <div key={s.id} className="flex items-center gap-2 px-1 text-[12.5px]">
                    <span className="w-28 truncate text-admin-ink/80">{s.roomType.name}</span>
                    <span className="w-32 text-admin-muted">{s.totalQuota} ({s.pendingQuota + s.bookedQuota})</span>
                    <span className="w-32 font-semibold text-admin-ink">{formatRupiah(s.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {active.map(s => (
            <PriceCard key={s.id} ownerType="hotel" ownerId={s.id} title={`Harga kamar ${s.roomType.name}: modal, jual, untung`} reloadKey={priceTick} onChanged={() => void onSaved()} />
          ))}
        </div>
      )}
    </div>
  )
}
