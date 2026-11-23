import { AlertTriangle } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { marginNote, type NoteRef } from '@/lib/pricing/marginNote'
import { MarginNote } from './MarginNote'

// Peringatan harga jual saat mengetik — SATU tampilan untuk PriceCard dan Komponen Biaya (docs/arsitektur-harga-terpadu.md §21–§22).
// HANYA mengingatkan (Fase 8): di bawah modal = rugi per satuan; selain itu catatan selisih terhadap rekomendasi (`marginNote`). Internal admin.

type Props = {
  /** Harga jual yang sedang diketik/berlaku. ≤ 0 → tidak ada peringatan. */
  sell: number
  /** Modal (HPP) — null bila belum diketahui. */
  cost: number | null
  /** Pembanding catatan selisih (rekomendasi / harga paket / jumlah komponen). */
  recommended: number | null
  marginPercent: number
  noteRef?: NoteRef
}

export function SellPriceWarnings({ sell, cost, recommended, marginPercent, noteRef = 'margin' }: Props) {
  if (!(sell > 0)) return null
  if (cost != null && sell < cost) {
    return (
      <p className="m-0 flex items-start gap-1.5 text-xs font-medium text-admin-warning">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Di bawah modal ({formatRupiah(cost)}) — rugi {formatRupiah(cost - sell)} per satuan. Peringatan internal; tetap bisa disimpan.
      </p>
    )
  }
  const note = marginNote({ sell, recommended, ref: noteRef, marginPercent })
  return note ? <MarginNote note={note} /> : null
}
