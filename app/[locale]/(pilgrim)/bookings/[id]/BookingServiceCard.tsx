import type { LucideIcon } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'

export type ServiceRow = { id: string; name: string; detail: string; price: number }

/** Satu kartu layanan yang ditagih di detail booking jamaah. Kosong = tidak dirender. */
export function BookingServiceCard({ icon: Icon, title, rows }: { icon: LucideIcon; title: string; rows: ServiceRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <h3 className="font-semibold flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /> {title}</h3>
      {rows.map(r => (
        <div key={r.id} className="flex justify-between gap-4 text-sm">
          <div>
            <p className="font-medium">{r.name}</p>
            <p className="text-muted-foreground first-letter:uppercase">{r.detail}</p>
          </div>
          <p className="font-semibold whitespace-nowrap">{formatRupiah(r.price)}</p>
        </div>
      ))}
    </div>
  )
}
