import { AlertTriangle, TrendingUp } from 'lucide-react'
import type { PriceNote } from '@/lib/pricing/marginNote'

/** Tampilan catatan selisih harga (`marginNote`): di bawah pembanding = peringatan kuning, di atas = hijau. */
export function MarginNote({ note }: { note: PriceNote }) {
  const Icon = note.below ? AlertTriangle : TrendingUp
  return (
    <p className={`m-0 flex items-start gap-1.5 text-xs font-medium ${note.below ? 'text-admin-warning' : 'text-admin-ok'}`}>
      <Icon className="mt-0.5 size-3.5 shrink-0" /> {note.text}
    </p>
  )
}
