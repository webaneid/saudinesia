import cron from 'node-cron'
import { prisma } from '@/lib/db'
import { refreshAllPricingCaches } from '@/lib/pricing/refreshAll'
import { logError } from '@/lib/log'
import { assessExchangeRate } from '@/lib/pricing/exchangeRateSanity'

const API_BASE = 'https://open.er-api.com/v6/latest'
const PAIRS: Array<{ from: string; to: string }> = [
  { from: 'USD', to: 'IDR' },
  { from: 'SAR', to: 'IDR' },
]

// Sementara hardcode — pindah ke setting admin (PricingRule/settings) di Fase 3, lihat docs/arsitektur-harga.md §9 Step 3
const DEFAULT_SPREAD_PERCENT = 1.5

type ExchangeRateApiResponse = {
  result: string
  rates: Record<string, unknown>
}

async function fetchLatestRates(baseCurrency: string): Promise<ExchangeRateApiResponse> {
  const res = await fetch(`${API_BASE}/${baseCurrency}`)
  if (!res.ok) throw new Error(`ExchangeRate API HTTP ${res.status} for base ${baseCurrency}`)
  const data = (await res.json()) as ExchangeRateApiResponse
  if (data.result !== 'success') throw new Error(`ExchangeRate API result="${data.result}" for base ${baseCurrency}`)
  return data
}

export async function refreshExchangeRates(): Promise<void> {
  // USD diambil lebih dulu (urutan PAIRS) — SAR diperiksa terhadap patokan 3,75 atas USD yang DITERIMA (docs/arsitektur-harga.md §4.1:
  // SAR tetap diambil langsung, patokan hanya pemeriksaan kewajaran).
  const accepted: Record<string, number> = {}
  const updatedCurrencies: string[] = []

  for (const { from, to } of PAIRS) {
    try {
      const data = await fetchLatestRates(from)
      const raw = data.rates[to]
      const last = await prisma.exchangeRate.findFirst({
        where: { fromCurrency: from, toCurrency: to },
        orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
        select: { midRate: true, fetchedAt: true },
      })
      // Kurs rusak/anomali TIDAK disimpan — kurs terakhir tetap dipakai HPP & harga otomatis (SEC-307).
      const verdict = assessExchangeRate({
        from, mid: raw, now: new Date(),
        previous: last ? { mid: Number(last.midRate), fetchedAt: last.fetchedAt } : null,
        acceptedUsdMid: accepted.USD,
      })
      if (!verdict.ok) {
        console.warn(`[cron] ExchangeRate ${from}->${to} DITOLAK (${verdict.reason}: ${verdict.detail}) — kurs terakhir tetap dipakai`)
        continue
      }
      if (verdict.rebased) console.warn(`[cron] ExchangeRate ${from}->${to}: lonjakan > 10% diterima karena kurs tersimpan sudah > 72 jam`)
      const midRate = raw as number
      accepted[from] = midRate

      const sellRate = midRate * (1 + DEFAULT_SPREAD_PERCENT / 100)
      await prisma.exchangeRate.create({
        data: {
          fromCurrency: from,
          toCurrency: to,
          midRate,
          spreadPercent: DEFAULT_SPREAD_PERCENT,
          sellRate,
          source: 'EXCHANGERATE_API',
        },
      })
      updatedCurrencies.push(from)
      console.log(`[cron] ExchangeRate ${from}->${to}: mid=${midRate} sell=${sellRate.toFixed(4)}`)
    } catch (err) {
      // Satu pasangan gagal tidak boleh menggagalkan yang lain — lihat docs/arsitektur-harga.md §4.2
      logError('cron ExchangeRate fetch gagal', err, { pair: `${from}->${to}` })
    }
  }

  if (updatedCurrencies.length > 0) {
    const failed = await refreshAllPricingCaches(updatedCurrencies)
    console.log(`[cron] Cache harga di-refresh untuk currency: ${updatedCurrencies.join(', ')}${failed.length ? ` — GAGAL: ${failed.join(', ')}` : ''}`)
  }
}

export function startExchangeRateJob(): void {
  cron.schedule(
    '0 8,16 * * *',
    () => {
      void refreshExchangeRates()
    },
    { timezone: 'Asia/Jakarta' },
  )
  console.log('[cron] Exchange rate job scheduled (08:00 & 16:00 WIB)')
}
