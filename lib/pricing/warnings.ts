// SATU-SATUNYA aturan peringatan harga (docs/arsitektur-harga-terpadu.md §21). Fungsi MURNI — dipakai server (respons API, laporan) dan UI (pratinjau langsung) supaya tak ada dua tafsir.
// PERINGATAN HANYA MENGINGATKAN: tidak ada yang menolak, memblokir, atau mewajibkan apa pun karena level di sini (arahan pemilik 2026-10-28: harga boleh berapa pun, bahkan rugi).
// Hasilnya INTERNAL admin — tidak pernah masuk invoice, API jamaah, atau notifikasi (invarian I5).

export type PricingLevel = 'ok' | 'below_recommended' | 'below_cost'

export type PricingInput = {
  /** Σ modal baris yang modalnya diketahui (HPP awal yang diketahui). */
  costKnownIdr: number
  /** Jumlah baris yang modalnya belum diketahui — HPP sebenarnya ≥ `costKnownIdr`. */
  costUnknownLines: number
  /** Σ rekomendasi baris yang rekomendasinya diketahui (HPP + margin bawaan saat dipesan). */
  recommendedIdr: number
  /** Jumlah baris lama tanpa rekomendasi beku — rekomendasi sebenarnya ≥ `recommendedIdr`. */
  recommendedUnknownLines: number
  /** Harga jual total (patokan) = `Booking.totalAmount`. */
  sellIdr: number
}

export type PricingEvaluation = {
  level: PricingLevel
  costIdr: number
  recommendedIdr: number
  sellIdr: number
  /** jual − HPP diketahui. Bila `incompleteCost`, ini batas atas untung sebenarnya. */
  marginIdr: number
  /** margin atas harga jual (sama dengan laporan untung); null bila jual ≤ 0. */
  marginPct: number | null
  /** rekomendasi − jual bila jual di bawah rekomendasi, selain itu 0; null bila rekomendasi tak dapat dipastikan. */
  shortfallVsRecommendedIdr: number | null
  /** HPP − jual bila jual di bawah HPP, selain itu 0. */
  lossIdr: number
  /** Ada baris tanpa modal: HPP/untung belum lengkap. `below_cost` tetap sahih (HPP sebenarnya paling sedikit sebesar yang diketahui). */
  incompleteCost: boolean
  /** Ada baris lama tanpa rekomendasi beku: perbandingan dengan rekomendasi tidak dipastikan (tidak ditebak). */
  incompleteRecommended: boolean
}

const cents = (x: number): number => Math.round(x * 100)
const round2 = (x: number): number => cents(x) / 100

/**
 * Aturan:
 *  - `below_cost`        : jual < HPP diketahui (rugi pasti, sekalipun HPP belum lengkap).
 *  - `below_recommended` : HPP ≤ jual < rekomendasi, hanya bila rekomendasi lengkap dan > 0.
 *  - `ok`                : selain itu. Banding dilakukan dalam sen bulat (tanpa galat pecahan).
 */
export function evaluatePricing(i: PricingInput): PricingEvaluation {
  const cost = cents(i.costKnownIdr), rec = cents(i.recommendedIdr), sell = cents(i.sellIdr)
  const incompleteCost = i.costUnknownLines > 0
  const incompleteRecommended = i.recommendedUnknownLines > 0

  const belowCost = sell < cost
  const belowRecommended = !belowCost && !incompleteRecommended && rec > 0 && sell < rec
  const level: PricingLevel = belowCost ? 'below_cost' : belowRecommended ? 'below_recommended' : 'ok'

  return {
    level,
    costIdr: round2(i.costKnownIdr), recommendedIdr: round2(i.recommendedIdr), sellIdr: round2(i.sellIdr),
    marginIdr: (sell - cost) / 100,
    marginPct: sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 + 0 : null, // `+ 0` menormalkan -0 (tampil "-0%")
    shortfallVsRecommendedIdr: incompleteRecommended ? null : Math.max(0, rec - sell) / 100,
    lossIdr: Math.max(0, cost - sell) / 100,
    incompleteCost, incompleteRecommended,
  }
}
