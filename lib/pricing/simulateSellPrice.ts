import { getLatestRate, resolveMarginRule, roundToNearest } from './pricingHelpers'

export type SimulateComponent = { currency: string; cost: number }
export type SimulateResult = { hppRupiah: number; minSellPrice: number; sellPrice: number }

/**
 * Hitung HPP → harga jual dari angka yang SEDANG diketik (belum tentu tersimpan) —
 * dipakai untuk preview live di admin UI, bukan dari data booking nyata. Rumus identik
 * dengan computeSellPrice() (margin + pembulatan), cuma sumber komponennya beda: langsung
 * dari input, bukan baca ProductCost dari DB. Lihat docs/arsitektur-harga.md §16.
 *
 * Beda dari computeSellPrice(): kurs yang tidak ditemukan untuk salah satu currency
 * membuat seluruh hasil jadi null (bukan diam-diam skip komponen itu) — di sini semua
 * komponen yang dikirim memang dimaksudkan untuk dihitung.
 */
export async function simulateSellPrice(
  productType: string,
  components: SimulateComponent[],
): Promise<SimulateResult | null> {
  let hppRupiah = 0

  for (const component of components) {
    if (!component.cost || component.cost <= 0) continue

    // Biaya sudah dalam Rupiah — tidak butuh konversi kurs, dan ExchangeRate IDR->IDR memang
    // tidak pernah ada (cron kurs cuma fetch USD/IDR & SAR/IDR). Lihat docs/arsitektur-harga.md §19.
    if (component.currency === 'IDR') {
      hppRupiah += component.cost
      continue
    }

    const rate = await getLatestRate(component.currency, 'IDR')
    if (!rate) return null
    hppRupiah += component.cost * Number(rate.sellRate)
  }

  const { minMarginPercent, roundingIncrement } = await resolveMarginRule(productType)

  const minSellPrice = hppRupiah * (1 + minMarginPercent / 100)
  const sellPrice = roundToNearest(minSellPrice, roundingIncrement)

  return { hppRupiah, minSellPrice, sellPrice }
}
