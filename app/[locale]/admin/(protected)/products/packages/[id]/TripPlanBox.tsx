'use client'

import { Plus, Route, Trash2 } from 'lucide-react'
import { MetaBox } from '@/components/admin/editor/MetaBox'

export type ItineraryRow = { day: string; title: string; body: string }
export type TripPlanForm = { durationDays: string; itinerary: ItineraryRow[]; exclusions: string }

type Props = { value: TripPlanForm; onChange: (patch: Partial<TripPlanForm>) => void }

// Durasi, rencana perjalanan per hari, dan "tidak termasuk" (K1-4, K1-5) — bagian formulir paket, disimpan oleh tombol Simpan paket.
// Server memvalidasi ulang (hari unik berurutan, tak melewati durasi; lib/validators/package.ts).
export function TripPlanBox({ value, onChange }: Props) {
  const rows = value.itinerary
  const setRow = (i: number, patch: Partial<ItineraryRow>) => onChange({ itinerary: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const nextDay = rows.length === 0 ? 1 : Math.max(...rows.map(r => Number(r.day) || 0)) + 1

  return (
    <MetaBox title="Durasi & Rencana Perjalanan" icon={Route} description="Tampil di halaman detail paket. Tanggal pulang setiap keberangkatan = berangkat + durasi − 1.">
      <div className="max-w-xs">
        <label htmlFor="pkg-duration" className="mb-1 block text-xs text-admin-muted">Durasi paket (hari)</label>
        <input id="pkg-duration" type="number" inputMode="numeric" min={1} max={60} className="admin-inp" placeholder="mis. 9" value={value.durationDays} onChange={e => onChange({ durationDays: e.target.value })} />
      </div>

      <div className="grid gap-2">
        <p className="m-0 text-xs font-semibold text-admin-ink">Rencana perjalanan per hari</p>
        {rows.length === 0 && <p className="m-0 text-xs text-admin-muted">Belum ada. Tambahkan hari demi hari (judul singkat + keterangan).</p>}
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-admin-line p-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-start">
            <div>
              <label htmlFor={`it-day-${i}`} className="mb-1 block text-xs text-admin-muted">Hari ke-</label>
              <input id={`it-day-${i}`} type="number" inputMode="numeric" min={1} max={60} className="admin-inp" value={r.day} onChange={e => setRow(i, { day: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div>
                <label htmlFor={`it-title-${i}`} className="mb-1 block text-xs text-admin-muted">Judul</label>
                <input id={`it-title-${i}`} className="admin-inp" maxLength={120} placeholder="mis. Tiba di Madinah" value={r.title} onChange={e => setRow(i, { title: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`it-body-${i}`} className="mb-1 block text-xs text-admin-muted">Keterangan</label>
                <textarea id={`it-body-${i}`} className="admin-inp" rows={2} maxLength={2000} value={r.body} onChange={e => setRow(i, { body: e.target.value })} />
              </div>
            </div>
            <button type="button" aria-label={`Hapus hari ${r.day}`} onClick={() => onChange({ itinerary: rows.filter((_, j) => j !== i) })} className="admin-btn-ghost self-end text-admin-danger sm:self-start">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <div>
          <button type="button" onClick={() => onChange({ itinerary: [...rows, { day: String(nextDay), title: '', body: '' }] })} className="admin-btn-sm">
            <Plus className="size-3.5" /> Tambah hari
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="pkg-exclusions" className="mb-1 block text-xs text-admin-muted">Tidak termasuk (satu baris per butir)</label>
        <textarea id="pkg-exclusions" className="admin-inp" rows={3} value={value.exclusions} onChange={e => onChange({ exclusions: e.target.value })}
          placeholder={'Pembuatan paspor\nKelebihan bagasi\nPengeluaran pribadi'} />
      </div>
    </MetaBox>
  )
}
