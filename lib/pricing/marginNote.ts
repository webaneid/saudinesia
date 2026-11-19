import { formatRupiah } from '@/lib/utils'

// Catatan selisih harga jual terhadap pembandingnya (docs/arsitektur-harga-terpadu.md §21, §22) — SATU aturan untuk PriceCard dan baris Komponen Biaya.
// HANYA mengingatkan: tak pernah menolak/mengunci. Internal admin (tak pernah ke jamaah/invoice). Di bawah modal ditangani peringatan rugi tersendiri.

/** Pembanding: `margin` = rekomendasi HPP × margin; `package` = harga paket (varian keberangkatan); `components` = jumlah harga Komponen Biaya (produk komposit). */
export type NoteRef = 'margin' | 'package' | 'components'
export type PriceNote = { below: boolean; text: string }

export function marginNote(o: { sell: number; recommended: number | null; ref: NoteRef; marginPercent: number }): PriceNote | null {
  if (o.recommended == null || !(o.sell > 0)) return null
  const diff = Math.round((o.sell - o.recommended) * 100) / 100
  if (diff === 0) return null
  const ref = o.ref === 'package' ? `harga paket (${formatRupiah(o.recommended)})`
    : o.ref === 'components' ? `jumlah harga komponen (${formatRupiah(o.recommended)})`
    : `harga margin ${o.marginPercent}% (${formatRupiah(o.recommended)})`
  if (diff > 0) return { below: false, text: `Lebih tinggi ${formatRupiah(diff)} dari ${ref}.` }
  return {
    below: true,
    text: o.ref === 'margin'
      ? `Lebih kecil dari margin yang ditentukan (${o.marginPercent}%) — kurang ${formatRupiah(-diff)} dari ${ref}. Tetap bisa disimpan.`
      : `Lebih kecil ${formatRupiah(-diff)} dari ${ref}.`,
  }
}
