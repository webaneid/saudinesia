import { History } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { formatInstant } from '@/lib/time'
import type { RevisionChange } from '@/lib/booking/revisionLog'

type Row = { id: string; revision: number; kind: string; reason: string | null; summary: unknown; totalBefore: number; totalAfter: number; taxBefore: number; taxAfter: number; byName: string | null; createdAt: Date }

const KIND: Record<string, string> = { items: 'Isi booking', total: 'Atur total' }

// Riwayat revisi booking (docs/arsitektur-booking-engine-v2.md §10.4 6b, D13) — INTERNAL admin: siapa, kapan, alasan, ringkasan, total sebelum → sesudah.
export function RevisionHistory({ rows }: { rows: Row[] }) {
  return (
    <div className="kartu p-4 space-y-3">
      <p className="admin-section flex items-center gap-1.5"><History className="size-3.5" /> Riwayat revisi</p>
      {rows.length === 0 ? <p className="m-0 text-[12px] text-admin-muted">Belum ada revisi sejak terbit.</p> : (
        <ol className="m-0 list-none space-y-3 p-0">
          {rows.map(r => (
            <li key={r.id} className="border-l-2 border-admin-line pl-3 text-[12px]">
              <p className="m-0 font-semibold text-admin-ink">Revisi ke-{r.revision} · {KIND[r.kind] ?? r.kind}</p>
              <p className="m-0 text-admin-muted">{formatInstant(r.createdAt)}{r.byName ? ` · ${r.byName}` : ''}</p>
              <ul className="m-0 mt-1 list-disc pl-4 text-admin-ink/80">
                {(Array.isArray(r.summary) ? (r.summary as RevisionChange[]) : []).map((c, i) => <li key={i}>{c.label}{c.detail ? ` — ${c.detail}` : ''}</li>)}
              </ul>
              <p className="m-0 mt-1 tabular-nums text-admin-muted">Subtotal {formatRupiah(r.totalBefore)} → {formatRupiah(r.totalAfter)} · pajak {formatRupiah(r.taxBefore)} → {formatRupiah(r.taxAfter)}</p>
              {r.reason && <p className="m-0 mt-1 whitespace-pre-line text-admin-ink">Alasan: {r.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
