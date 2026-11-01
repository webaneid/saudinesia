import { itemIndexOf } from './errors'

/**
 * Subtotal baris yang TIDAK bermasalah saat pratinjau gagal karena satu baris (galat berindeks, mis. tanggal di luar periode harga):
 * pratinjau diulang tanpa baris yang gagal sampai berhasil. Hanya untuk tampilan subtotal per baris di editor — ringkasan invoice
 * tetap tidak ditampilkan (angka parsial bisa disangka final). `run(keep)` = pratinjau rollback atas item berindeks `keep` (urut masukan)
 * yang mengembalikan total per item urut `keep`. Galat tanpa indeks (aturan visa, pelanggan) menghentikan percobaan. Hasil `null` = tak dihitung.
 */
export async function partialItemTotals(count: number, firstBad: number, run: (keep: number[]) => Promise<number[]>): Promise<(number | null)[]> {
  const bad = new Set([firstBad])
  for (let attempt = 0; attempt < count; attempt++) {
    const keep = Array.from({ length: count }, (_, i) => i).filter(i => !bad.has(i))
    if (keep.length === 0) break
    try {
      const totals = await run(keep)
      return Array.from({ length: count }, (_, i) => { const k = keep.indexOf(i); return k < 0 ? null : totals[k] ?? null })
    } catch (e) {
      const j = itemIndexOf(e)
      const original = j === undefined ? undefined : keep[j]
      if (original === undefined) break
      bad.add(original)
    }
  }
  return Array.from({ length: count }, () => null)
}
