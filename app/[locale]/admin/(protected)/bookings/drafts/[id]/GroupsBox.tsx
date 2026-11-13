'use client'

import { Plus, Trash2, UsersRound } from 'lucide-react'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { Button } from '@/components/admin/ui/Button'
import { groupLabel } from '@/lib/booking/groupNames'
import type { GroupDraft } from './groupRows'

// Kotak "Rombongan" di editor draf dan revisi (docs/arsitektur-booking-engine-v2.md §10.8, 11d-2a). Draf mengatur ukuran rombongan di sini; revisi memindahkan
// jamaah per orang di kotak Jamaah (ukuran = jumlah jamaah yang menunjuknya). Nama rombongan teks bebas pemesan (≤ 60) — tampil di invoice, tak masuk riwayat.

type Props = {
  groups: GroupDraft[]
  onChange: (groups: GroupDraft[]) => void
  sizes: number[]
  onStart: () => void
  onAdd: () => void
  onRemove: (index: number) => void
  /** Draf: ukuran diketik di sini (min = slot bervisa di rombongan itu). Revisi: tidak diisi (ukuran tampil saja). */
  resize?: { min: number[]; set: (index: number, n: number) => void }
}

export function GroupsBox({ groups, onChange, sizes, onStart, onAdd, onRemove, resize }: Props) {
  const patch = (i: number, p: Partial<GroupDraft>) => onChange(groups.map((g, j) => (j === i ? { ...g, ...p } : g)))
  return (
    <MetaBox title="Rombongan" icon={UsersRound} collapsible={false}
      description="Satu booking dapat memuat beberapa rombongan dengan perjalanan berbeda. Produk ditujukan ke satu rombongan atau semua; jumlah orangnya mengikuti rombongan.">
      {groups.length < 2 ? (
        <div className="space-y-2">
          <p className="m-0 text-sm text-admin-muted">Satu rombongan — semua jamaah berangkat bersama.</p>
          <Button size="sm" variant="outline" onClick={onStart}><Plus className="size-4" /> Bagi ke beberapa rombongan</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g, i) => (
            <div key={g.id ?? `baru-${i}`} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-admin-line p-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_1.75rem]">
              <label className="col-span-2 block space-y-0.5 md:col-span-1">
                <span className="block text-[11px] text-admin-muted">Nama (opsional)</span>
                <input className="admin-inp-xs" maxLength={60} placeholder={groupLabel(null, i)} aria-label={`Nama rombongan ${i + 1}`} value={g.label} onChange={e => patch(i, { label: e.target.value })} />
              </label>
              <label className="block space-y-0.5">
                <span className="block text-[11px] text-admin-muted">Rencana berangkat</span>
                <input type="date" className="admin-inp-xs" aria-label={`Rencana berangkat rombongan ${i + 1}`} value={g.plannedTravelDate} onChange={e => patch(i, { plannedTravelDate: e.target.value })} />
              </label>
              <label className="block space-y-0.5">
                <span className="block text-[11px] text-admin-muted">Jamaah</span>
                {resize
                  ? <input type="number" min={Math.max(1, resize.min[i] ?? 0)} max={2000} className="admin-inp-xs" aria-label={`Jumlah jamaah rombongan ${i + 1}`} value={sizes[i] ?? 0} onChange={e => resize.set(i, Number(e.target.value) || 1)} />
                  : <span className={`block py-1 text-sm tabular-nums ${sizes[i] ? 'text-admin-ink' : 'font-semibold text-admin-danger'}`}>{sizes[i] ?? 0}</span>}
              </label>
              <button type="button" aria-label={`Hapus rombongan ${i + 1}`} onClick={() => onRemove(i)} className="justify-self-end rounded p-1 text-admin-muted hover:text-admin-danger"><Trash2 className="size-4" /></button>
              {!sizes[i] && <p className="col-span-full m-0 text-[11px] font-medium text-admin-danger">Belum punya jamaah — pindahkan jamaah ke rombongan ini atau hapus rombongannya.</p>}
            </div>
          ))}
          <p className="m-0 text-[11px] text-admin-muted">Rencana berangkat dipakai visa rombongan yang tidak punya tiket. Menghapus rombongan hingga tinggal satu = tanpa rombongan.</p>
          <Button size="sm" variant="outline" onClick={onAdd}><Plus className="size-4" /> Tambah rombongan</Button>
        </div>
      )}
    </MetaBox>
  )
}
