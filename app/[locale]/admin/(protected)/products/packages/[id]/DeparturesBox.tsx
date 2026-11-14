'use client'

import { useCallback, useState } from 'react'
import { AlertTriangle, CalendarDays } from 'lucide-react'
import { ListCrudBox } from '@/components/admin/editor/ListCrudBox'
import { Badge } from '@/components/admin/ui/Badge'
import { formatCalendarDate, todayInApp } from '@/lib/time'
import type { DepartureView } from '@/lib/packages/departures'
import type { DepartureWarnings } from '@/lib/packages/warnings'

type Form = { departureDate: string; totalSeats: string; note: string; isActive: boolean }

/** Sisa kursi di bawah ini ditandai "hampir penuh" di editor. */
const FEW_SEATS = 5

// Keberangkatan paket (K1, docs/arsitektur-paket-umroh.md §8): daftar tanggal + kursi, tersimpan langsung ke server (bukan tombol Simpan paket).
// Peringatan (periode tiket/hotel, malam vs durasi) hanya mengingatkan — server yang menolak saat dipesan.
export function DeparturesBox({ packageId }: { packageId: string }) {
  const [warnings, setWarnings] = useState<DepartureWarnings | null>(null)
  const onMeta = useCallback((meta: Record<string, unknown> | undefined) => {
    setWarnings((meta?.warnings as DepartureWarnings | undefined) ?? null)
  }, [])

  return (
    <ListCrudBox<DepartureView, Form>
      title="Keberangkatan" icon={CalendarDays}
      description="Pelanggan memilih tanggal dari daftar ini; tanggal pulang dari durasi paket. Setelah dipesan, tanggal terkunci dan hapus = nonaktif."
      apiBase={`/api/v1/admin/products/packages/${packageId}/departures`}
      noun="keberangkatan" emptyText="Belum ada keberangkatan — paket belum bisa dipesan."
      onMeta={onMeta}
      header={warnings && warnings.package.length > 0 && (
        <ul className="m-0 grid list-none gap-1 rounded-xl border border-admin-warning/40 bg-admin-warning/10 p-3 text-xs text-admin-ink">
          {warnings.package.map(w => <li key={w} className="flex gap-2"><AlertTriangle className="size-4 shrink-0 text-admin-warning" aria-hidden /> {w}</li>)}
        </ul>
      )}
      summary={row => {
        const ws = warnings?.byDeparture[row.id] ?? []
        return (
          <div className="grid gap-0.5">
            <p className="m-0 font-semibold">
              {formatCalendarDate(row.departureDate)}{row.returnDate ? ` – ${formatCalendarDate(row.returnDate)}` : ''}
            </p>
            <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-admin-muted">
              <span>Sisa {row.seatsLeft} dari {row.totalSeats} kursi</span>
              {row.pendingSeats > 0 && <span>Ditahan {row.pendingSeats}</span>}
              {row.bookedSeats > 0 && <span>Terjual {row.bookedSeats}</span>}
              {row.isActive && row.seatsLeft === 0 && <Badge tone="danger">Penuh</Badge>}
              {row.isActive && row.seatsLeft > 0 && row.seatsLeft <= FEW_SEATS && <Badge tone="warning">Hampir penuh</Badge>}
              {row.departureDate < todayInApp() && <Badge tone="neutral">Sudah lewat</Badge>}
            </p>
            {row.note && <p className="m-0 text-xs text-admin-muted">Catatan internal: {row.note}</p>}
            {ws.map(w => <p key={w} className="m-0 flex gap-1.5 text-xs text-admin-warning"><AlertTriangle className="size-3.5 shrink-0" aria-hidden /> {w}</p>)}
          </div>
        )
      }}
      blank={{ departureDate: '', totalSeats: '45', note: '', isActive: true }}
      toForm={row => ({ departureDate: row.departureDate, totalSeats: String(row.totalSeats), note: row.note ?? '', isActive: row.isActive })}
      precheck={f => (!f.departureDate ? 'Pilih tanggal keberangkatan.' : !/^\d+$/.test(f.totalSeats) || Number(f.totalSeats) < 1 ? 'Kursi minimal 1.' : null)}
      toBody={f => ({ departureDate: f.departureDate, totalSeats: Number(f.totalSeats), note: f.note.trim() || null, isActive: f.isActive })}
      renderFields={(f, set) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="dep-date" className="mb-1 block text-xs text-admin-muted">Tanggal berangkat</label>
              <input id="dep-date" type="date" className="admin-inp" min={todayInApp()} value={f.departureDate} onChange={e => set({ departureDate: e.target.value })} />
            </div>
            <div>
              <label htmlFor="dep-seats" className="mb-1 block text-xs text-admin-muted">Total kursi</label>
              <input id="dep-seats" type="number" inputMode="numeric" min={1} className="admin-inp" value={f.totalSeats} onChange={e => set({ totalSeats: e.target.value })} />
            </div>
          </div>
          <div>
            <label htmlFor="dep-note" className="mb-1 block text-xs text-admin-muted">Catatan internal (tidak tampil ke pelanggan)</label>
            <input id="dep-note" className="admin-inp" maxLength={500} placeholder="mis. blok kursi GA 980" value={f.note} onChange={e => set({ note: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={e => set({ isActive: e.target.checked })} /> Aktif (bisa dipesan)</label>
        </>
      )}
    />
  )
}
