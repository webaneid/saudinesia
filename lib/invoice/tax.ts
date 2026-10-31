// Murni — pajak invoice (docs/arsitektur-booking-engine-v2.md §10.4 Fase 6a, D14). Dipakai penerbitan, pratinjau draf, dan (Fase 6b) revisi: SATU rumus.
// Dasar = Σ snapshot harga (sesudah diskon/penyesuaian = Booking.totalAmount, sebelum pajak). Tiap aturan dihitung dari dasar yang sama (tidak bertumpuk).
//  • added    → pajak = dasar × dasar% × tarif%, DITAMBAHKAN ke tagihan;
//  • included → porsi pajak di DALAM harga = dasar × f / (1 + f), f = dasar% × tarif% — tagihan tak berubah, hanya ditampilkan.
// Dibulatkan ke rupiah penuh (setengah ke atas). Tarif 0 atau dasar ≤ 0 → tak ada baris.

export type TaxMode = 'added' | 'included'
export type TaxRuleInput = { name: string; ratePercent: number; basisPercent: number; mode: TaxMode }
export type TaxLine = TaxRuleInput & { amountIdr: number }
export type TaxResult = { lines: TaxLine[]; addedIdr: number; includedIdr: number }

// Pembulatan ke rupiah yang tahan galat biner (12345.5 tersimpan sebagai 12345.49999…).
const roundIdr = (v: number) => Math.round(Number(v.toFixed(6)))

export function computeTax(baseIdr: number, rules: readonly TaxRuleInput[]): TaxResult {
  const lines: TaxLine[] = []
  if (baseIdr > 0) {
    for (const r of rules) {
      if (!(r.ratePercent > 0) || !(r.basisPercent > 0)) continue
      const f = (r.basisPercent / 100) * (r.ratePercent / 100)
      const amountIdr = r.mode === 'added' ? roundIdr(baseIdr * f) : roundIdr((baseIdr * f) / (1 + f))
      lines.push({ name: r.name, ratePercent: r.ratePercent, basisPercent: r.basisPercent, mode: r.mode, amountIdr })
    }
  }
  const sum = (m: TaxMode) => lines.filter(l => l.mode === m).reduce((s, l) => s + l.amountIdr, 0)
  return { lines, addedIdr: sum('added'), includedIdr: sum('included') }
}
